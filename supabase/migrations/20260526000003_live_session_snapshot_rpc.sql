-- Load live-session rows in one consistent round-trip.

create or replace function public.get_live_session_snapshot_versioned(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_player_rows jsonb;
  v_pair_rows jsonb;
  v_round_rows jsonb;
  v_live_match_rows jsonb;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for share;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can load live session snapshot';
  end if;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.checked_in_at), '[]'::jsonb)
  into v_player_rows
  from (
    select *
    from public.session_player_state
    where session_id = p_session_id
    order by checked_in_at
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.player_a, row_data.player_b), '[]'::jsonb)
  into v_pair_rows
  from (
    select *
    from public.session_pair_history
    where session_id = p_session_id
    order by player_a, player_b
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.round_no), '[]'::jsonb)
  into v_round_rows
  from (
    select *
    from public.session_rounds
    where session_id = p_session_id
    order by round_no
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sequence_no), '[]'::jsonb)
  into v_live_match_rows
  from (
    select *
    from public.session_live_matches
    where session_id = p_session_id
    order by sequence_no
  ) row_data;

  return jsonb_build_object(
    'live_state_version', v_live_state_version,
    'player_rows', v_player_rows,
    'pair_rows', v_pair_rows,
    'round_rows', v_round_rows,
    'live_match_rows', v_live_match_rows
  );
end;
$$;

revoke all on function public.get_live_session_snapshot_versioned(uuid) from public, anon, authenticated;
grant execute on function public.get_live_session_snapshot_versioned(uuid) to authenticated;

notify pgrst, 'reload schema';
