-- Optimize the versioned end-round hot path by committing DB-side deltas from
-- the active round. The function signature stays unchanged so existing Edge
-- and client callers keep working.

create or replace function public.complete_live_session_round_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_round_no int,
  p_player_state jsonb,
  p_pair_history jsonb,
  p_score_after int,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_host_id uuid;
  v_live_state_version bigint;
  v_round public.session_rounds;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_resting_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
begin
  -- Keep arguments in the signature for backward compatibility. Commit deltas
  -- are derived from the persisted active round below.
  perform p_player_state, p_pair_history;

  select id, host_id, live_state_version
  into v_session_id, v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_session_id is null then
    raise exception 'Session not found';
  end if;

  if v_host_id <> auth.uid() then
    raise exception 'Only the host can complete round';
  end if;

  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select *
  into v_round
  from public.session_rounds
  where session_id = p_session_id
    and round_no = p_round_no
    and status = 'active'
  for update;

  if v_round.id is null then
    raise exception 'Active round not found';
  end if;

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  played as (
    select distinct ids.player_id
    from match_rows
    cross join lateral unnest(team_a || team_b) as ids(player_id)
  ),
  updated as (
    update public.session_player_state sps
    set
      matches_played = sps.matches_played + 1,
      last_played_round = p_round_no,
      consecutive_rest = 0,
      consecutive_play = sps.consecutive_play + 1,
      opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated;

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  played as (
    select distinct ids.player_id
    from match_rows
    cross join lateral unnest(team_a || team_b) as ids(player_id)
  ),
  resting as (
    select distinct jsonb_array_elements_text(coalesce(v_round.resting, '[]'::jsonb))::uuid as player_id
  ),
  updated as (
    update public.session_player_state sps
    set
      consecutive_rest = sps.consecutive_rest + 1,
      consecutive_play = 0,
      opted_rest = false
    from resting
    where sps.session_id = p_session_id
      and sps.player_id = resting.player_id
      and sps.checked_out_at is null
      and not exists (
        select 1
        from played
        where played.player_id = sps.player_id
      )
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_resting_state
  from updated;

  v_changed_player_state := v_changed_player_state || v_changed_resting_state;

  with match_rows as (
    select
      array(select jsonb_array_elements_text(match.value -> 'team_a')::uuid) as team_a,
      array(select jsonb_array_elements_text(match.value -> 'team_b')::uuid) as team_b
    from jsonb_array_elements(coalesce(v_round.matches, '[]'::jsonb)) as match(value)
  ),
  pair_deltas as (
    select
      least(team_a[1], team_a[2]) as player_a,
      greatest(team_a[1], team_a[2]) as player_b,
      1::int as partner_count,
      0::int as opponent_count
    from match_rows
    where array_length(team_a, 1) = 2
    union all
    select
      least(team_b[1], team_b[2]) as player_a,
      greatest(team_b[1], team_b[2]) as player_b,
      1::int as partner_count,
      0::int as opponent_count
    from match_rows
    where array_length(team_b, 1) = 2
    union all
    select
      least(a.player_id, b.player_id) as player_a,
      greatest(a.player_id, b.player_id) as player_b,
      0::int as partner_count,
      1::int as opponent_count
    from match_rows
    cross join lateral unnest(team_a) as a(player_id)
    cross join lateral unnest(team_b) as b(player_id)
    where array_length(team_a, 1) = 2
      and array_length(team_b, 1) = 2
  ),
  grouped_pair_deltas as (
    select
      player_a,
      player_b,
      sum(partner_count)::int as partner_count,
      sum(opponent_count)::int as opponent_count
    from pair_deltas
    group by player_a, player_b
  ),
  upserted as (
    insert into public.session_pair_history (
      session_id,
      player_a,
      player_b,
      partner_count,
      opponent_count
    )
    select
      p_session_id,
      player_a,
      player_b,
      partner_count,
      opponent_count
    from grouped_pair_deltas
    on conflict (session_id, player_a, player_b) do update set
      partner_count = public.session_pair_history.partner_count + excluded.partner_count,
      opponent_count = public.session_pair_history.opponent_count + excluded.opponent_count
    returning public.session_pair_history.*
  )
  select coalesce(jsonb_agg(to_jsonb(upserted) order by upserted.player_a, upserted.player_b), '[]'::jsonb)
  into v_changed_pair_history
  from upserted;

  update public.session_rounds
  set
    status = 'completed',
    ended_at = now()
  where id = v_round.id
  returning * into v_round;

  update public.suggester_adjustments
  set fairness_score_after = p_score_after
  where session_id = p_session_id
    and round_no = p_round_no;

  insert into public.suggester_decision_events (
    session_id,
    round_no,
    event_type,
    event_source,
    actor_id,
    payload
  )
  values (
    p_session_id,
    p_round_no,
    'round_ended',
    'system',
    auth.uid(),
    coalesce(p_audit_payload, '{}'::jsonb) ||
      jsonb_build_object(
        'round_id', v_round.id,
        'experimental_versioned_rpc', true,
        'db_delta_commit', true
      )
  );

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  return jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version,
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$$;

grant execute on function public.complete_live_session_round_versioned(uuid, bigint, int, jsonb, jsonb, int, jsonb) to authenticated;
