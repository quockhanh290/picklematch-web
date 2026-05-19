create or replace function public.start_live_session_round(
  p_session_id uuid,
  p_round_no int,
  p_matches jsonb,
  p_resting jsonb,
  p_event_source text,
  p_actor_id uuid,
  p_audit_payload jsonb,
  p_adjustment_warnings text[] default '{}'::text[],
  p_adjustment_config_changes jsonb default '{}'::jsonb,
  p_adjustment_tier_overrides jsonb default '{}'::jsonb,
  p_fairness_score_before int default null
)
returns public.session_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.session_rounds;
begin
  insert into public.session_rounds (
    session_id,
    round_no,
    status,
    matches,
    resting,
    started_at
  )
  values (
    p_session_id,
    p_round_no,
    'active',
    p_matches,
    p_resting,
    now()
  )
  returning * into v_round;

  if coalesce(array_length(p_adjustment_warnings, 1), 0) > 0 then
    insert into public.suggester_adjustments (
      session_id,
      round_no,
      triggered_by_warnings,
      config_changes,
      tier_overrides,
      fairness_score_before
    )
    values (
      p_session_id,
      p_round_no,
      p_adjustment_warnings,
      p_adjustment_config_changes,
      p_adjustment_tier_overrides,
      p_fairness_score_before
    );
  end if;

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
    'round_started',
    p_event_source,
    p_actor_id,
    coalesce(p_audit_payload, '{}'::jsonb)
  );

  return v_round;
end;
$$;

revoke all on function public.start_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  text,
  uuid,
  jsonb,
  text[],
  jsonb,
  jsonb,
  int
) from public, anon, authenticated;

grant execute on function public.start_live_session_round(
  uuid,
  int,
  jsonb,
  jsonb,
  text,
  uuid,
  jsonb,
  text[],
  jsonb,
  jsonb,
  int
) to service_role;
