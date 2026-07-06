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
begin
  raise exception 'Legacy round flow is disabled. Complete individual live matches instead.';
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
) to authenticated;

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
begin
  raise exception 'Legacy round flow is disabled. Complete individual live matches instead.';
end;
$$;

revoke all on function public.complete_live_session_round_versioned(
  uuid,
  bigint,
  int,
  jsonb,
  jsonb,
  int,
  jsonb
) from public, anon, authenticated;

grant execute on function public.complete_live_session_round_versioned(
  uuid,
  bigint,
  int,
  jsonb,
  jsonb,
  int,
  jsonb
) to authenticated;

create or replace function public.swap_live_session_round_player_versioned(
  p_session_id uuid,
  p_out_player_id uuid,
  p_in_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Legacy round flow is disabled. Use live match cancel/recreate controls instead.';
end;
$$;

revoke all on function public.swap_live_session_round_player_versioned(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.swap_live_session_round_player_versioned(
  uuid,
  uuid,
  uuid
) to authenticated;
