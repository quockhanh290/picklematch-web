-- Thêm round_no vào session_live_matches để group các trận theo vòng.
-- Một vòng = tất cả trận được tạo cùng 1 batch (cùng số sân).
-- consecutive_rest/play chỉ cập nhật khi cả vòng hoàn thành.

alter table public.session_live_matches
  add column if not exists round_no int;

-- Backfill: data cũ, mỗi trận tự thành 1 vòng riêng (sequence_no làm round_no)
update public.session_live_matches
  set round_no = sequence_no
  where round_no is null;

alter table public.session_live_matches
  alter column round_no set not null;

create index if not exists idx_session_live_matches_round
  on public.session_live_matches(session_id, round_no);

-- ============================================================
-- create_live_session_matches_versioned
-- Tất cả matches trong cùng 1 batch nhận cùng round_no mới
-- ============================================================
create or replace function public.create_live_session_matches_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_matches jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_base_sequence int;
  v_round_no int;
  v_inserted jsonb := '[]'::jsonb;
  v_next_version bigint;
begin
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'Matches must be an array';
  end if;

  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can create live matches';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
    )
    select 1
    from match_players mp
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = mp.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Suggested matches must use available checked-in players';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
    )
    select 1
    from match_players mp
    join public.session_live_matches slm
      on slm.session_id = p_session_id
     and slm.status in ('suggested', 'live')
     and (
       slm.team_a ? mp.player_id::text
       or slm.team_b ? mp.player_id::text
     )
  ) then
    raise exception 'A suggested player is already assigned to a live/suggested match';
  end if;

  -- Tính sequence_no tiếp theo
  select coalesce(max(sequence_no) + 1, 0)
  into v_base_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  -- round_no: dùng round hiện tại nếu còn match đang active (live/suggested),
  -- tránh tạo round mới khi chưa kết thúc vòng.
  select coalesce(
    (select min(round_no)
     from public.session_live_matches
     where session_id = p_session_id
       and status in ('suggested', 'live')),
    coalesce(
      (select max(round_no) + 1 from public.session_live_matches where session_id = p_session_id),
      0
    )
  ) into v_round_no;

  with inserted as (
    insert into public.session_live_matches (
      session_id,
      sequence_no,
      round_no,
      court_idx,
      status,
      team_a,
      team_b,
      resting
    )
    select
      p_session_id,
      v_base_sequence + ordinality::int - 1,
      v_round_no,
      nullif((match.value ->> 'court_idx')::int, -1),
      'suggested',
      match.value -> 'team_a',
      match.value -> 'team_b',
      coalesce(match.value -> 'resting', '[]'::jsonb)
    from jsonb_array_elements(p_matches) with ordinality as match(value, ordinality)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.sequence_no), '[]'::jsonb)
  into v_inserted
  from inserted;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_round_no,
    'live_matches_suggested',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('matches', v_inserted)
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'matches', v_inserted
  );
end;
$$;

-- ============================================================
-- complete_live_session_match_versioned
-- Khi complete 1 trận: nếu tất cả trận của round_no đã xong
-- → cập nhật consecutive_rest cho người có mặt nhưng không chơi vòng đó
-- ============================================================
create or replace function public.complete_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_score_after int,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_match public.session_live_matches;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
  v_round_complete boolean := false;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can complete live match';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'Only live matches can be completed';
  end if;

  update public.session_live_matches
  set status = 'completed',
      score_a = greatest(0, p_score_a),
      score_b = greatest(0, p_score_b),
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  -- Cập nhật matches_played, last_played_round, consecutive_play cho người chơi
  with played as (
    select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
    union
    select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
  ),
  updated_played as (
    update public.session_player_state sps
    set matches_played = sps.matches_played + 1,
        last_played_round = v_match.round_no,
        consecutive_play = sps.consecutive_play + 1,
        consecutive_rest = 0,
        opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated_played) order by updated_played.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated_played;

  -- Cập nhật pair history
  with match_teams as (
    select
      array(select jsonb_array_elements_text(v_match.team_a)::uuid) as team_a,
      array(select jsonb_array_elements_text(v_match.team_b)::uuid) as team_b
  ),
  partner_pairs as (
    select least(team_a[1], team_a[2]) as player_a, greatest(team_a[1], team_a[2]) as player_b
    from match_teams
    union all
    select least(team_b[1], team_b[2]) as player_a, greatest(team_b[1], team_b[2]) as player_b
    from match_teams
  ),
  opponent_pairs as (
    select least(a.player_id, b.player_id) as player_a, greatest(a.player_id, b.player_id) as player_b
    from match_teams
    cross join lateral unnest(team_a) as a(player_id)
    cross join lateral unnest(team_b) as b(player_id)
  ),
  pair_deltas as (
    select player_a, player_b, count(*)::int as partner_delta, 0::int as opponent_delta
    from partner_pairs
    group by player_a, player_b
    union all
    select player_a, player_b, 0::int as partner_delta, count(*)::int as opponent_delta
    from opponent_pairs
    group by player_a, player_b
  ),
  merged_deltas as (
    select player_a, player_b, sum(partner_delta)::int as partner_delta, sum(opponent_delta)::int as opponent_delta
    from pair_deltas
    group by player_a, player_b
  ),
  upserted as (
    insert into public.session_pair_history(session_id, player_a, player_b, partner_count, opponent_count)
    select p_session_id, player_a, player_b, partner_delta, opponent_delta
    from merged_deltas
    on conflict (session_id, player_a, player_b)
    do update set
      partner_count = public.session_pair_history.partner_count + excluded.partner_count,
      opponent_count = public.session_pair_history.opponent_count + excluded.opponent_count
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(upserted) order by upserted.player_a, upserted.player_b), '[]'::jsonb)
  into v_changed_pair_history
  from upserted;

  -- Kiểm tra vòng đã hoàn thành chưa (tất cả trận cùng round_no đã completed/cancelled)
  select not exists (
    select 1 from public.session_live_matches
    where session_id = p_session_id
      and round_no = v_match.round_no
      and status not in ('completed', 'cancelled')
  ) into v_round_complete;

  if v_round_complete then
    -- Cập nhật consecutive_rest cho người có mặt nhưng không chơi trận nào trong vòng này
    with round_played as (
      select distinct jsonb_array_elements_text(team_a)::uuid as player_id
      from public.session_live_matches
      where session_id = p_session_id
        and round_no = v_match.round_no
        and status = 'completed'
      union
      select distinct jsonb_array_elements_text(team_b)::uuid
      from public.session_live_matches
      where session_id = p_session_id
        and round_no = v_match.round_no
        and status = 'completed'
    ),
    updated_resting as (
      update public.session_player_state sps
      set consecutive_rest = sps.consecutive_rest + 1,
          consecutive_play = 0
      where sps.session_id = p_session_id
        and sps.checked_out_at is null
        and not sps.opted_rest
        and sps.player_id not in (select player_id from round_played)
      returning sps.*
    )
    select coalesce(
      v_changed_player_state || jsonb_agg(to_jsonb(updated_resting) order by updated_resting.player_id),
      v_changed_player_state
    )
    into v_changed_player_state
    from updated_resting;
  end if;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_completed',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'match', to_jsonb(v_match),
      'score_after', p_score_after,
      'round_complete', v_round_complete
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$$;

revoke all on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) to authenticated;

-- ============================================================
-- start_live_session_match_from_payload_versioned
-- Nhận round_no từ payload. Nếu không có: dùng round_no của
-- các trận đang active, hoặc tạo round mới.
-- ============================================================
create or replace function public.start_live_session_match_from_payload_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_match public.session_live_matches;
  v_next_sequence int;
  v_round_no int;
  v_next_version bigint;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can start live match';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;
  if p_match is null or jsonb_typeof(p_match) <> 'object' then
    raise exception 'Match payload is required';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(p_match -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(p_match -> 'team_b')::uuid as player_id
    )
    select 1
    from match_players mp
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = mp.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Live match must use available checked-in players';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(p_match -> 'team_a')::uuid as player_id
      union all
      select jsonb_array_elements_text(p_match -> 'team_b')::uuid as player_id
    )
    select 1
    from match_players mp
    join public.session_live_matches slm
      on slm.session_id = p_session_id
     and slm.status = 'live'
     and (slm.team_a ? mp.player_id::text or slm.team_b ? mp.player_id::text)
  ) then
    raise exception 'A player is already in a live match';
  end if;

  select coalesce(max(sequence_no) + 1, 0)
  into v_next_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  -- round_no: ưu tiên từ payload, sau đó lấy từ các trận đang active, cuối cùng tạo mới
  v_round_no := coalesce(
    nullif((p_match ->> 'round_no')::int, -1),
    (
      select max(round_no)
      from public.session_live_matches
      where session_id = p_session_id
        and status in ('suggested', 'live')
    ),
    coalesce(
      (select max(round_no) + 1 from public.session_live_matches where session_id = p_session_id),
      0
    )
  );

  insert into public.session_live_matches (
    session_id,
    sequence_no,
    round_no,
    court_idx,
    status,
    team_a,
    team_b,
    resting,
    started_at
  )
  values (
    p_session_id,
    v_next_sequence,
    v_round_no,
    nullif((p_match ->> 'court_idx')::int, -1),
    'live',
    p_match -> 'team_a',
    p_match -> 'team_b',
    coalesce(p_match -> 'resting', '[]'::jsonb),
    now()
  )
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.round_no,
    'live_match_started_from_payload',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$$;

revoke all on function public.start_live_session_match_from_payload_versioned(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.start_live_session_match_from_payload_versioned(uuid, bigint, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
