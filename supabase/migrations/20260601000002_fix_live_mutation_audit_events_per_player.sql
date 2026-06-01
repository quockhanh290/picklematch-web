-- Fix live mutation audit events to record one event per player for traceability.
-- This ensures the UI can query suggester_decision_events by player_id.

create or replace function public.checkin_live_session_players_versioned(
  p_session_id uuid,
  p_player_ids jsonb,
  p_group_with jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checked_in_at timestamptz := now();
  v_rows jsonb;
  v_row jsonb;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  with player_ids as (
    select distinct value::uuid as player_id
    from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
  ),
  group_ids as (
    select distinct value::uuid as player_id
    from jsonb_array_elements_text(coalesce(p_group_with, '[]'::jsonb))
  ),
  counts as (
    select
      (select count(*) from player_ids) as player_count,
      (select count(*) from group_ids) as group_count
  ),
  group_member_ids as (
    select player_id from player_ids
    union
    select player_id from group_ids
  ),
  group_value as (
    select case
      when (select player_count from counts) = 1 and (select count(*) from group_member_ids) > 1
        then p_session_id::text || ':' || (select string_agg(player_id::text, ':' order by player_id::text) from group_member_ids)
      else null
    end as group_id
  ),
  upserted as (
    insert into public.session_player_state (
      session_id,
      player_id,
      group_id,
      checked_in_at,
      checked_out_at,
      opted_rest
    )
    select
      p_session_id,
      player_ids.player_id,
      group_value.group_id,
      v_checked_in_at,
      null,
      false
    from player_ids
    cross join group_value
    on conflict (session_id, player_id) do update set
      group_id = excluded.group_id,
      checked_in_at = excluded.checked_in_at,
      checked_out_at = null,
      opted_rest = false
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(upserted)), '[]'::jsonb)
  into v_rows
  from upserted;

  if jsonb_array_length(v_rows) = 0 then
    raise exception 'Missing player_id';
  end if;

  v_next_version := public.bump_locked_live_state_version(p_session_id);

  -- Insert one audit event per player for full traceability
  for v_row in select * from jsonb_array_elements(v_rows) loop
    perform public.insert_live_mutation_audit_event(
      p_session_id,
      null,
      'player_checked_in',
      jsonb_build_object(
        'player_id', v_row ->> 'player_id',
        'player_ids', p_player_ids,
        'group_with', coalesce(p_group_with, '[]'::jsonb),
        'group_id', v_row -> 'group_id',
        'checked_in_at', v_row -> 'checked_in_at'
      )
    );
  end loop;

  return jsonb_build_object(
    'players', v_rows,
    'player', v_rows -> 0,
    'live_state_version', v_next_version
  );
end;
$$;

create or replace function public.checkout_live_session_players_versioned(
  p_session_id uuid,
  p_player_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checked_out_at timestamptz := now();
  v_rows jsonb;
  v_row jsonb;
  v_cancelled_matches jsonb := '[]'::jsonb;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  v_cancelled_matches := public.cancel_suggested_live_matches_for_players(p_session_id, p_player_ids);

  with player_ids as (
    select distinct value::uuid as player_id
    from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
  ),
  updated as (
    update public.session_player_state sps
    set
      checked_out_at = v_checked_out_at,
      opted_rest = false
    from player_ids
    where sps.session_id = p_session_id
      and sps.player_id = player_ids.player_id
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
  into v_rows
  from updated;

  if jsonb_array_length(v_rows) > 0 or jsonb_array_length(v_cancelled_matches) > 0 then
    v_next_version := public.bump_locked_live_state_version(p_session_id);
  else
    select live_state_version into v_next_version from public.sessions where id = p_session_id;
  end if;

  -- Insert one audit event per player for full traceability
  for v_row in select * from jsonb_array_elements(v_rows) loop
    perform public.insert_live_mutation_audit_event(
      p_session_id,
      null,
      'player_checked_out',
      jsonb_build_object(
        'player_id', v_row ->> 'player_id',
        'player_ids', p_player_ids,
        'checked_out_at', v_row -> 'checked_out_at',
        'cancelled_matches', v_cancelled_matches
      )
    );
  end loop;

  return jsonb_build_object(
    'players', v_rows,
    'player', v_rows -> 0,
    'cancelled_matches', v_cancelled_matches,
    'live_state_version', v_next_version
  );
end;
$$;

revoke all on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) to service_role;

revoke all on function public.checkout_live_session_players_versioned(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.checkout_live_session_players_versioned(uuid, jsonb) to authenticated;
grant execute on function public.checkout_live_session_players_versioned(uuid, jsonb) to service_role;
