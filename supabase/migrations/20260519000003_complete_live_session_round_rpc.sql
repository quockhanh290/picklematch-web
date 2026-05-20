create or replace function public.complete_live_session_round(
  p_session_id uuid,
  p_round_no int,
  p_player_state jsonb,
  p_pair_history jsonb,
  p_score_after int,
  p_actor_id uuid,
  p_audit_payload jsonb
)
returns public.session_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.session_rounds;
begin
  insert into public.session_player_state (
    session_id,
    player_id,
    matches_played,
    last_played_round,
    consecutive_rest,
    consecutive_play,
    opted_rest
  )
  select
    p_session_id,
    payload.player_id,
    payload.matches_played,
    payload.last_played_round,
    payload.consecutive_rest,
    payload.consecutive_play,
    payload.opted_rest
  from jsonb_to_recordset(coalesce(p_player_state, '[]'::jsonb)) as payload(
    player_id uuid,
    matches_played int,
    last_played_round int,
    consecutive_rest int,
    consecutive_play int,
    opted_rest boolean
  )
  on conflict (session_id, player_id) do update set
    matches_played = excluded.matches_played,
    last_played_round = excluded.last_played_round,
    consecutive_rest = excluded.consecutive_rest,
    consecutive_play = excluded.consecutive_play,
    opted_rest = excluded.opted_rest;

  insert into public.session_pair_history (
    session_id,
    player_a,
    player_b,
    partner_count,
    opponent_count
  )
  select
    p_session_id,
    payload.player_a,
    payload.player_b,
    payload.partner_count,
    payload.opponent_count
  from jsonb_to_recordset(coalesce(p_pair_history, '[]'::jsonb)) as payload(
    player_a uuid,
    player_b uuid,
    partner_count int,
    opponent_count int
  )
  on conflict (session_id, player_a, player_b) do update set
    partner_count = excluded.partner_count,
    opponent_count = excluded.opponent_count;

  update public.session_rounds
  set
    status = 'completed',
    ended_at = now()
  where session_id = p_session_id
    and round_no = p_round_no
    and status = 'active'
  returning * into v_round;

  if v_round.id is null then
    raise exception 'Active round not found';
  end if;

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
    p_actor_id,
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('round_id', v_round.id)
  );

  return v_round;
end;
$$;

revoke all on function public.complete_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  int,
  uuid,
  jsonb
) from public, anon, authenticated;

grant execute on function public.complete_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  int,
  uuid,
  jsonb
) to service_role;
