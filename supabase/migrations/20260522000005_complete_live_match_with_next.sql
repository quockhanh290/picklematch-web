create or replace function public.complete_live_session_match_with_next_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_score_after int,
  p_next_match jsonb default null,
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
  v_created_match public.session_live_matches;
  v_next_sequence int;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
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
  resting as (
    select jsonb_array_elements_text(v_match.resting)::uuid as player_id
  ),
  updated_played as (
    update public.session_player_state sps
    set matches_played = sps.matches_played + 1,
        last_played_round = v_match.sequence_no,
        consecutive_play = sps.consecutive_play + 1,
        consecutive_rest = 0,
        opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  ),
  updated_resting as (
    update public.session_player_state sps
    set consecutive_rest = sps.consecutive_rest + 1,
        consecutive_play = 0
    from resting
    where sps.session_id = p_session_id
      and sps.player_id = resting.player_id
      and sps.checked_out_at is null
      and not sps.opted_rest
      and not exists (select 1 from played where played.player_id = sps.player_id)
    returning sps.*
  ),
  changed as (
    select * from updated_played
    union all
    select * from updated_resting
  )
  select coalesce(jsonb_agg(to_jsonb(changed) order by changed.player_id), '[]'::jsonb)
  into v_changed_player_state
  from changed;

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

  if p_next_match is not null and jsonb_typeof(p_next_match) = 'object' then
    if exists (
      with match_players as (
        select jsonb_array_elements_text(p_next_match -> 'team_a')::uuid as player_id
        union all
        select jsonb_array_elements_text(p_next_match -> 'team_b')::uuid as player_id
      )
      select 1
      from match_players mp
      left join public.session_player_state sps
        on sps.session_id = p_session_id and sps.player_id = mp.player_id
      where sps.player_id is null
        or sps.checked_out_at is not null
        or sps.opted_rest
    ) then
      raise exception 'Suggested match must use available checked-in players';
    end if;

    if exists (
      with match_players as (
        select jsonb_array_elements_text(p_next_match -> 'team_a')::uuid as player_id
        union all
        select jsonb_array_elements_text(p_next_match -> 'team_b')::uuid as player_id
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

    select coalesce(max(sequence_no) + 1, 0)
    into v_next_sequence
    from public.session_live_matches
    where session_id = p_session_id;

    insert into public.session_live_matches (
      session_id,
      sequence_no,
      court_idx,
      status,
      team_a,
      team_b,
      resting
    )
    values (
      p_session_id,
      v_next_sequence,
      nullif((p_next_match ->> 'court_idx')::int, -1),
      'suggested',
      p_next_match -> 'team_a',
      p_next_match -> 'team_b',
      coalesce(p_next_match -> 'resting', '[]'::jsonb)
    )
    returning * into v_created_match;
  end if;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_completed_with_next',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'match', to_jsonb(v_match),
      'created_match', case when v_created_match.id is null then null else to_jsonb(v_created_match) end,
      'score_after', p_score_after
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'created_match', case when v_created_match.id is null then null else to_jsonb(v_created_match) end,
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$$;

revoke all on function public.complete_live_session_match_with_next_versioned(uuid, bigint, uuid, int, int, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_live_session_match_with_next_versioned(uuid, bigint, uuid, int, int, int, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
