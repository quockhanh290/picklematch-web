create or replace function public.cancel_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
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
    raise exception 'Only the host can cancel live match';
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
  if v_match.status not in ('suggested', 'live') then
    raise exception 'Only suggested/live matches can be cancelled';
  end if;

  update public.session_live_matches
  set status = 'cancelled',
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_cancelled',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', '[]'::jsonb,
    'changed_pair_history', '[]'::jsonb
  );
end;
$$;

revoke all on function public.cancel_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cancel_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
