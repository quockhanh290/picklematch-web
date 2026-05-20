-- Experimental atomic live-state mutation RPCs.
-- Each RPC validates host access, applies the live mutation, bumps sessions.live_state_version,
-- and returns in a single database transaction.

create or replace function public.assert_live_session_host_locked(p_session_id uuid)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
begin
  select *
  into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'Session not found';
  end if;

  if auth.uid() is not null and v_session.host_id <> auth.uid() then
    raise exception 'Only the host can manage live session state';
  end if;

  return v_session;
end;
$$;

create or replace function public.bump_locked_live_state_version(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_version bigint;
begin
  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  if v_next_version is null then
    raise exception 'Session not found';
  end if;

  return v_next_version;
end;
$$;

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
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

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

  if jsonb_array_length(v_rows) > 0 then
    v_next_version := public.bump_locked_live_state_version(p_session_id);
  else
    select live_state_version into v_next_version from public.sessions where id = p_session_id;
  end if;

  return jsonb_build_object(
    'players', v_rows,
    'player', v_rows -> 0,
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
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  update public.session_player_state
  set opted_rest = coalesce(p_opted_rest, true)
  where session_id = p_session_id
    and player_id = p_player_id
  returning * into v_row;

  if v_row.session_id is null then
    raise exception 'Player state not found';
  end if;

  v_next_version := public.bump_locked_live_state_version(p_session_id);

  return jsonb_build_object(
    'player', to_jsonb(v_row),
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
  v_group_id text;
  v_rows jsonb;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  if p_clear_group_id is not null then
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

  if jsonb_array_length(v_rows) > 0 then
    v_next_version := public.bump_locked_live_state_version(p_session_id);
  else
    select live_state_version into v_next_version from public.sessions where id = p_session_id;
  end if;

  return jsonb_build_object(
    'group_id', v_group_id,
    'players', v_rows,
    'live_state_version', v_next_version
  );
end;
$$;

create or replace function public.sync_live_session_roster_versioned(
  p_session_id uuid,
  p_player_ids jsonb,
  p_revive_checked_out boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_inserted_ids uuid[] := '{}';
  v_revived_ids uuid[] := '{}';
  v_checkout_ids uuid[] := '{}';
  v_requested_count int := 0;
  v_next_version bigint;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  with requested as (
    select distinct value::uuid as player_id
    from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb))
  ),
  existing as (
    select player_id, checked_out_at
    from public.session_player_state
    where session_id = p_session_id
  )
  select
    coalesce((select count(*) from requested), 0),
    coalesce(array(select requested.player_id from requested left join existing using (player_id) where existing.player_id is null), '{}'),
    coalesce(array(select existing.player_id from existing join requested using (player_id) where p_revive_checked_out is true and existing.checked_out_at is not null), '{}'),
    coalesce(array(select existing.player_id from existing left join requested using (player_id) where requested.player_id is null and existing.checked_out_at is null), '{}')
  into v_requested_count, v_inserted_ids, v_revived_ids, v_checkout_ids;

  if v_requested_count = 0 then
    raise exception 'No player_ids provided for roster sync';
  end if;

  insert into public.session_player_state (
    session_id,
    player_id,
    checked_in_at,
    checked_out_at,
    opted_rest
  )
  select
    p_session_id,
    player_id,
    v_now,
    null,
    false
  from unnest(v_inserted_ids) as player_id
  on conflict (session_id, player_id) do nothing;

  update public.session_player_state
  set
    checked_out_at = null,
    opted_rest = false
  where session_id = p_session_id
    and player_id = any(v_revived_ids);

  update public.session_player_state
  set
    checked_out_at = v_now,
    opted_rest = false
  where session_id = p_session_id
    and player_id = any(v_checkout_ids);

  if coalesce(array_length(v_inserted_ids, 1), 0) + coalesce(array_length(v_revived_ids, 1), 0) + coalesce(array_length(v_checkout_ids, 1), 0) > 0 then
    v_next_version := public.bump_locked_live_state_version(p_session_id);
  else
    select live_state_version into v_next_version from public.sessions where id = p_session_id;
  end if;

  return jsonb_build_object(
    'inserted', coalesce(array_length(v_inserted_ids, 1), 0),
    'revived', coalesce(array_length(v_revived_ids, 1), 0),
    'removed', coalesce(array_length(v_checkout_ids, 1), 0),
    'total', v_requested_count,
    'inserted_player_ids', to_jsonb(v_inserted_ids),
    'revived_player_ids', to_jsonb(v_revived_ids),
    'checked_out_player_ids', to_jsonb(v_checkout_ids),
    'live_state_version', v_next_version
  );
end;
$$;

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
declare
  v_round public.session_rounds;
  v_matches jsonb;
  v_resting jsonb;
  v_checked_out_at timestamptz := now();
  v_next_version bigint;
  v_all_active_ids uuid[];
  v_in_checked_out_at timestamptz;
begin
  perform public.assert_live_session_host_locked(p_session_id);

  if p_out_player_id = p_in_player_id then
    raise exception 'out_player_id and in_player_id must be different';
  end if;

  select *
  into v_round
  from public.session_rounds
  where session_id = p_session_id
    and status = 'active'
  order by round_no desc
  limit 1
  for update;

  if v_round.id is null then
    raise exception 'No active round found';
  end if;

  v_matches := coalesce(v_round.matches, '[]'::jsonb);
  v_resting := coalesce(v_round.resting, '[]'::jsonb);

  select coalesce(array_agg(distinct ids.player_id), '{}')
  into v_all_active_ids
  from jsonb_array_elements(v_matches) as match(value)
  cross join lateral (
    select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
    union all
    select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
  ) ids;

  if not (p_out_player_id = any(v_all_active_ids)) then
    raise exception 'out_player_id is not in any active match';
  end if;

  if p_in_player_id = any(v_all_active_ids) then
    raise exception 'in_player_id is already in an active match';
  end if;

  select checked_out_at
  into v_in_checked_out_at
  from public.session_player_state
  where session_id = p_session_id
    and player_id = p_in_player_id;

  if not found then
    raise exception 'in_player_id not found in session';
  end if;

  if v_in_checked_out_at is not null then
    raise exception 'in_player_id has already checked out';
  end if;

  with updated_matches as (
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(
          match.value,
          '{team_a}',
          (
            select jsonb_agg(case when value::uuid = p_out_player_id then to_jsonb(p_in_player_id::text) else to_jsonb(value) end)
            from jsonb_array_elements_text(match.value -> 'team_a')
          )
        ),
        '{team_b}',
        (
          select jsonb_agg(case when value::uuid = p_out_player_id then to_jsonb(p_in_player_id::text) else to_jsonb(value) end)
          from jsonb_array_elements_text(match.value -> 'team_b')
        )
      )
      order by coalesce((match.value ->> 'court_idx')::int, 0)
    ), '[]'::jsonb) as matches
    from jsonb_array_elements(v_matches) as match(value)
  )
  select matches into v_matches from updated_matches;

  update public.session_rounds
  set matches = v_matches
  where id = v_round.id
  returning * into v_round;

  update public.session_player_state
  set
    checked_out_at = v_checked_out_at,
    opted_rest = false
  where session_id = p_session_id
    and player_id = p_out_player_id;

  v_next_version := public.bump_locked_live_state_version(p_session_id);

  return jsonb_build_object(
    'round', to_jsonb(v_round),
    'live_state_version', v_next_version
  );
end;
$$;

revoke all on function public.assert_live_session_host_locked(uuid) from public, anon, authenticated;
revoke all on function public.bump_locked_live_state_version(uuid) from public, anon, authenticated;
revoke all on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.checkout_live_session_players_versioned(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_live_session_player_rest_versioned(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_live_session_group_versioned(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_live_session_roster_versioned(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.swap_live_session_round_player_versioned(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.checkout_live_session_players_versioned(uuid, jsonb) to authenticated;
grant execute on function public.set_live_session_player_rest_versioned(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_live_session_group_versioned(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.sync_live_session_roster_versioned(uuid, jsonb, boolean) to authenticated;
grant execute on function public.swap_live_session_round_player_versioned(uuid, uuid, uuid) to authenticated;

grant execute on function public.checkin_live_session_players_versioned(uuid, jsonb, jsonb) to service_role;
grant execute on function public.checkout_live_session_players_versioned(uuid, jsonb) to service_role;
grant execute on function public.set_live_session_player_rest_versioned(uuid, uuid, boolean) to service_role;
grant execute on function public.set_live_session_group_versioned(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.sync_live_session_roster_versioned(uuid, jsonb, boolean) to service_role;
grant execute on function public.swap_live_session_round_player_versioned(uuid, uuid, uuid) to service_role;
