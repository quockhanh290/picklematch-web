-- Next-match mode creates live match rows one by one. A round must not be
-- treated as complete just because the currently known rows for that round
-- are all completed; otherwise consecutive_rest increments once per match.

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
  v_expected_round_matches int := 1;
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

  with match_teams as (
    select
      array(select jsonb_array_elements_text(v_match.team_a)::uuid) as team_a,
      array(select jsonb_array_elements_text(v_match.team_b)::uuid) as team_b
  ),
  partner_pairs as (
    select least(team_a[1], team_a[2]) as player_a, greatest(team_a[1], team_a[2]) as player_b
    from match_teams
    union
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

  select greatest(1, coalesce(court_count_override, 1))
  into v_expected_round_matches
  from public.session_next_round_settings
  where session_id = p_session_id;

  v_expected_round_matches := coalesce(v_expected_round_matches, 1);

  select
    count(*) filter (where status in ('completed', 'cancelled')) >= v_expected_round_matches
    and count(*) filter (where status not in ('completed', 'cancelled')) = 0
  into v_round_complete
  from public.session_live_matches
  where session_id = p_session_id
    and round_no = v_match.round_no;

  if v_round_complete then
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
      'round_complete', v_round_complete,
      'expected_round_matches', v_expected_round_matches
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

create or replace function public.repair_live_session_player_state_from_rounds(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
  v_expected_round_matches int := 1;
begin
  select host_id
  into v_host_id
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can repair live session state';
  end if;

  select greatest(1, coalesce(court_count_override, 1))
  into v_expected_round_matches
  from public.session_next_round_settings
  where session_id = p_session_id;

  v_expected_round_matches := coalesce(v_expected_round_matches, 1);

  with completed_live_rounds as (
    select
      slm.round_no,
      jsonb_agg(
        jsonb_build_object(
          'team_a', slm.team_a,
          'team_b', slm.team_b
        )
        order by slm.court_idx nulls last, slm.sequence_no
      ) as matches,
      min(slm.started_at) as started_at,
      max(slm.ended_at) as ended_at
    from public.session_live_matches slm
    where slm.session_id = p_session_id
      and slm.round_no is not null
    group by slm.round_no
    having
      count(*) filter (where slm.status in ('completed', 'cancelled')) >= v_expected_round_matches
      and count(*) filter (where slm.status not in ('completed', 'cancelled')) = 0
  ),
  completed_session_rounds as (
    select
      sr.round_no,
      sr.matches,
      sr.started_at,
      sr.ended_at
    from public.session_rounds sr
    where sr.session_id = p_session_id
      and sr.status = 'completed'
  ),
  all_rounds as (
    select * from completed_session_rounds
    union all
    select * from completed_live_rounds
  ),
  completed_match_players as (
    select
      slm.round_no,
      (player_id_text)::uuid as player_id
    from public.session_live_matches slm
    cross join lateral (
      select jsonb_array_elements_text(slm.team_a) as player_id_text
      union all
      select jsonb_array_elements_text(slm.team_b) as player_id_text
    ) played
    where slm.session_id = p_session_id
      and slm.status = 'completed'
      and slm.round_no is not null
    union
    select
      sr.round_no,
      (player_id_text)::uuid as player_id
    from public.session_rounds sr
    cross join lateral jsonb_array_elements(coalesce(sr.matches, '[]'::jsonb)) match
    cross join lateral (
      select jsonb_array_elements_text(match -> 'team_a') as player_id_text
      union all
      select jsonb_array_elements_text(match -> 'team_b') as player_id_text
    ) played
    where sr.session_id = p_session_id
      and sr.status = 'completed'
  ),
  round_players as (
    select
      r.round_no,
      (player_id_text)::uuid as player_id,
      true as played,
      r.started_at,
      r.ended_at
    from all_rounds r
    cross join lateral jsonb_array_elements(coalesce(r.matches, '[]'::jsonb)) match
    cross join lateral (
      select jsonb_array_elements_text(match -> 'team_a') as player_id_text
      union
      select jsonb_array_elements_text(match -> 'team_b') as player_id_text
    ) played
  ),
  round_windows as (
    select
      round_no,
      min(started_at) as started_at,
      max(ended_at) as ended_at
    from all_rounds
    group by round_no
  ),
  round_present as (
    select
      rw.round_no,
      sps.player_id,
      coalesce(rp.played, false) as played
    from round_windows rw
    join public.session_player_state sps
      on sps.session_id = p_session_id
     and (
       (rw.started_at is null and rw.ended_at is null and sps.checked_out_at is null)
       or (
         sps.checked_in_at <= coalesce(rw.ended_at, rw.started_at, now())
         and coalesce(sps.checked_out_at, 'infinity'::timestamptz) >= coalesce(rw.started_at, rw.ended_at, '-infinity'::timestamptz)
       )
     )
    left join round_players rp
      on rp.round_no = rw.round_no
     and rp.player_id = sps.player_id
  ),
  player_rounds as (
    select
      sps.player_id,
      rp.round_no,
      coalesce(rp.played, false) as played
    from public.session_player_state sps
    left join round_present rp
      on rp.player_id = sps.player_id
    where sps.session_id = p_session_id
  ),
  ordered as (
    select
      player_id,
      round_no,
      played,
      sum(case when played then 1 else 0 end) over (
        partition by player_id
        order by round_no
        rows between unbounded preceding and current row
      ) as play_group
    from player_rounds
    where round_no is not null
  ),
  computed as (
    select
      sps.player_id,
      coalesce((
        select count(*)::int
        from completed_match_players cmp
        where cmp.player_id = sps.player_id
      ), 0)::int as matches_played,
      coalesce((
        select max(cmp.round_no)::int
        from completed_match_players cmp
        where cmp.player_id = sps.player_id
      ), -1)::int as last_played_round,
      coalesce(count(*) filter (
        where o.played
          and o.round_no > coalesce((
            select max(o2.round_no)
            from ordered o2
            where o2.player_id = sps.player_id
              and not o2.played
          ), -1)
      ), 0)::int as consecutive_play,
      coalesce(count(*) filter (
        where not o.played
          and o.round_no > coalesce((
            select max(o2.round_no)
            from ordered o2
            where o2.player_id = sps.player_id
              and o2.played
          ), -1)
      ), 0)::int as consecutive_rest
    from public.session_player_state sps
    left join ordered o
      on o.player_id = sps.player_id
    where sps.session_id = p_session_id
    group by sps.player_id
  ),
  updated as (
    update public.session_player_state sps
    set
      matches_played = computed.matches_played,
      last_played_round = computed.last_played_round,
      consecutive_play = computed.consecutive_play,
      consecutive_rest = computed.consecutive_rest
    from computed
    where sps.session_id = p_session_id
      and sps.player_id = computed.player_id
      and (
        sps.matches_played is distinct from computed.matches_played
        or sps.last_played_round is distinct from computed.last_played_round
        or sps.consecutive_play is distinct from computed.consecutive_play
        or sps.consecutive_rest is distinct from computed.consecutive_rest
      )
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    null,
    'live_state_repaired',
    jsonb_build_object(
      'source', 'repair_live_session_player_state_from_rounds',
      'changed_player_count', jsonb_array_length(v_changed_player_state),
      'changed_player_state', v_changed_player_state,
      'expected_round_matches', v_expected_round_matches
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'changed_player_state', v_changed_player_state
  );
end;
$$;

revoke all on function public.repair_live_session_player_state_from_rounds(uuid) from public, anon, authenticated;
grant execute on function public.repair_live_session_player_state_from_rounds(uuid) to authenticated;

notify pgrst, 'reload schema';
