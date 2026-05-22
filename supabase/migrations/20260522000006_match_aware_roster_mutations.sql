create or replace function public.cancel_suggested_live_matches_for_players(
  p_session_id uuid,
  p_player_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled jsonb := '[]'::jsonb;
begin
  if exists (
    with affected as (
      select distinct value::uuid as player_id
      from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
    )
    select 1
    from public.session_live_matches slm
    join affected a
      on slm.session_id = p_session_id
     and slm.status = 'live'
     and (slm.team_a ? a.player_id::text or slm.team_b ? a.player_id::text)
  ) then
    raise exception 'Player is in a live match. Complete or cancel the match first.';
  end if;

  with affected as (
    select distinct value::uuid as player_id
    from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
  ),
  target_matches as (
    select distinct slm.id
    from public.session_live_matches slm
    join affected a
      on slm.session_id = p_session_id
     and slm.status = 'suggested'
     and (slm.team_a ? a.player_id::text or slm.team_b ? a.player_id::text)
  ),
  updated as (
    update public.session_live_matches slm
    set status = 'cancelled',
        ended_at = now()
    from target_matches
    where slm.id = target_matches.id
    returning slm.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.sequence_no), '[]'::jsonb)
  into v_cancelled
  from updated;

  return v_cancelled;
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

  perform public.insert_live_mutation_audit_event(
    p_session_id,
    null,
    'player_checked_out',
    jsonb_build_object(
      'player_id', case when jsonb_array_length(v_rows) = 1 then v_rows -> 0 ->> 'player_id' else null end,
      'player_ids', p_player_ids,
      'checked_out_at', case when jsonb_array_length(v_rows) = 1 then v_rows -> 0 -> 'checked_out_at' else 'null'::jsonb end,
      'cancelled_matches', v_cancelled_matches
    )
  );

  return jsonb_build_object(
    'players', v_rows,
    'player', v_rows -> 0,
    'cancelled_matches', v_cancelled_matches,
    'live_state_version', v_next_version
  );
end;
$$;

create or replace function public.set_live_session_player_rest_versioned(
  p_session_id uuid,
  p_player_id uuid,
  p_opted_rest boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.session_player_state;
  v_cancelled_matches jsonb := '[]'::jsonb;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  v_cancelled_matches := public.cancel_suggested_live_matches_for_players(
    p_session_id,
    jsonb_build_array(p_player_id)
  );

  update public.session_player_state
  set opted_rest = coalesce(p_opted_rest, true)
  where session_id = p_session_id
    and player_id = p_player_id
  returning * into v_row;

  if v_row.session_id is null then
    raise exception 'Player state not found';
  end if;

  v_next_version := public.bump_locked_live_state_version(p_session_id);

  perform public.insert_live_mutation_audit_event(
    p_session_id,
    null,
    'player_rest_changed',
    jsonb_build_object(
      'player_id', p_player_id,
      'opted_rest', coalesce(p_opted_rest, true),
      'cancelled_matches', v_cancelled_matches
    )
  );

  return jsonb_build_object(
    'player', to_jsonb(v_row),
    'cancelled_matches', v_cancelled_matches,
    'live_state_version', v_next_version
  );
end;
$$;

create or replace function public.set_live_session_group_versioned(
  p_session_id uuid,
  p_player_ids jsonb default '[]'::jsonb,
  p_clear_player_id uuid default null,
  p_clear_group_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := 'set_group';
  v_group_id text;
  v_rows jsonb;
  v_affected_player_ids jsonb := '[]'::jsonb;
  v_cancelled_matches jsonb := '[]'::jsonb;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  if p_clear_group_id is not null then
    v_action := 'clear_group';
    select coalesce(jsonb_agg(player_id), '[]'::jsonb)
    into v_affected_player_ids
    from public.session_player_state
    where session_id = p_session_id
      and group_id = p_clear_group_id;

    v_cancelled_matches := public.cancel_suggested_live_matches_for_players(p_session_id, v_affected_player_ids);

    with updated as (
      update public.session_player_state
      set group_id = null
      where session_id = p_session_id
        and group_id = p_clear_group_id
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
    into v_rows
    from updated;
  elsif p_clear_player_id is not null then
    v_action := 'clear_player';
    v_affected_player_ids := jsonb_build_array(p_clear_player_id);
    v_cancelled_matches := public.cancel_suggested_live_matches_for_players(p_session_id, v_affected_player_ids);

    with updated as (
      update public.session_player_state
      set group_id = null
      where session_id = p_session_id
        and player_id = p_clear_player_id
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
    into v_rows
    from updated;
  else
    v_affected_player_ids := coalesce(p_player_ids, '[]'::jsonb);
    v_cancelled_matches := public.cancel_suggested_live_matches_for_players(p_session_id, v_affected_player_ids);

    with player_ids as (
      select distinct value::uuid as player_id
      from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
    ),
    sorted as (
      select player_id
      from player_ids
      order by player_id::text
    ),
    group_value as (
      select
        count(*) as player_count,
        p_session_id::text || ':' || string_agg(player_id::text, ':' order by player_id::text) as group_id
      from sorted
    ),
    updated as (
      update public.session_player_state sps
      set group_id = group_value.group_id
      from sorted
      cross join group_value
      where sps.session_id = p_session_id
        and sps.player_id = sorted.player_id
        and group_value.player_count >= 2
      returning sps.*
    )
    select
      (select group_id from group_value),
      coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
    into v_group_id, v_rows
    from updated;

    if jsonb_array_length(v_rows) < 2 then
      raise exception 'A group needs at least two players';
    end if;
  end if;

  if jsonb_array_length(v_rows) > 0 or jsonb_array_length(v_cancelled_matches) > 0 then
    v_next_version := public.bump_locked_live_state_version(p_session_id);
  else
    select live_state_version into v_next_version from public.sessions where id = p_session_id;
  end if;

  perform public.insert_live_mutation_audit_event(
    p_session_id,
    null,
    'group_changed',
    jsonb_build_object(
      'action', v_action,
      'group_id', coalesce(p_clear_group_id, v_group_id),
      'player_id', p_clear_player_id,
      'player_ids', p_player_ids,
      'affected_player_ids', v_affected_player_ids,
      'cancelled_matches', v_cancelled_matches
    )
  );

  return jsonb_build_object(
    'group_id', v_group_id,
    'players', v_rows,
    'cancelled_matches', v_cancelled_matches,
    'live_state_version', v_next_version
  );
end;
$$;

revoke all on function public.cancel_suggested_live_matches_for_players(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cancel_suggested_live_matches_for_players(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
