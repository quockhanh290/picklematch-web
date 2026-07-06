create or replace function public.create_session_with_host(
  p_court_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price integer,
  p_elo_min integer,
  p_elo_max integer,
  p_is_ranked boolean,
  p_max_players integer,
  p_fill_deadline timestamptz,
  p_total_cost integer,
  p_require_approval boolean,
  p_court_booking_status text,
  p_booking_reference text,
  p_booking_name text,
  p_booking_phone text,
  p_booking_notes text,
  p_booking_confirmed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_slot_id uuid;
  v_session_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.court_slots (
    court_id,
    start_time,
    end_time,
    price,
    status
  ) values (
    p_court_id,
    p_start_time,
    p_end_time,
    coalesce(p_price, 0),
    'booked'
  )
  returning id into v_slot_id;

  insert into public.sessions (
    host_id,
    slot_id,
    elo_min,
    elo_max,
    is_ranked,
    max_players,
    status,
    fill_deadline,
    total_cost,
    require_approval,
    court_booking_status,
    booking_reference,
    booking_name,
    booking_phone,
    booking_notes,
    booking_confirmed_at
  ) values (
    v_uid,
    v_slot_id,
    p_elo_min,
    p_elo_max,
    coalesce(p_is_ranked, true),
    p_max_players,
    'open',
    p_fill_deadline,
    p_total_cost,
    coalesce(p_require_approval, false),
    p_court_booking_status,
    nullif(trim(coalesce(p_booking_reference, '')), ''),
    nullif(trim(coalesce(p_booking_name, '')), ''),
    nullif(trim(coalesce(p_booking_phone, '')), ''),
    nullif(trim(coalesce(p_booking_notes, '')), ''),
    p_booking_confirmed_at
  )
  returning id into v_session_id;

  insert into public.session_players (
    session_id,
    player_id,
    status
  ) values (
    v_session_id,
    v_uid,
    'confirmed'
  );

  return v_session_id;
end;
$$;

create or replace function public.approve_join_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_match_id uuid;
  v_player_id uuid;
  v_max_players integer;
  v_fill_deadline timestamptz;
  v_confirmed_count integer;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select
    jr.match_id,
    jr.player_id,
    s.max_players,
    s.fill_deadline
  into
    v_match_id,
    v_player_id,
    v_max_players,
    v_fill_deadline
  from public.join_requests jr
  join public.sessions s on s.id = jr.match_id
  where jr.id = p_request_id
    and jr.status = 'pending'
    and s.status = 'open'
    and s.host_id = v_uid
  for update of jr, s;

  if v_match_id is null then
    raise exception 'Join request not found or not allowed';
  end if;

  if v_fill_deadline is not null and v_fill_deadline <= now() then
    raise exception 'Session has stopped accepting new players';
  end if;

  if exists (
    select 1
    from public.session_players sp
    where sp.session_id = v_match_id
      and sp.player_id = v_player_id
  ) then
    update public.join_requests
    set status = 'accepted'
    where id = p_request_id;
    return v_player_id;
  end if;

  select count(*)
  into v_confirmed_count
  from public.session_players sp
  where sp.session_id = v_match_id
    and sp.status = 'confirmed';

  if v_confirmed_count >= coalesce(v_max_players, 0) then
    raise exception 'Session is already full';
  end if;

  insert into public.session_players (
    session_id,
    player_id,
    status
  ) values (
    v_match_id,
    v_player_id,
    'confirmed'
  );

  update public.join_requests
  set status = 'accepted'
  where id = p_request_id;

  return v_player_id;
end;
$$;

create or replace function public.cancel_host_session(
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_full boolean;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select (
    select count(*)
    from public.session_players sp
    where sp.session_id = s.id
      and sp.status = 'confirmed'
  ) >= s.max_players
  into v_is_full
  from public.sessions s
  where s.id = p_session_id
    and s.host_id = v_uid
  for update;

  if v_is_full is null then
    raise exception 'Session not found or not allowed';
  end if;

  update public.sessions
  set
    status = 'cancelled',
    was_full_when_cancelled = v_is_full
  where id = p_session_id;

  delete from public.session_players
  where session_id = p_session_id;

  delete from public.join_requests
  where match_id = p_session_id;

  return true;
end;
$$;

grant execute on function public.create_session_with_host(
  uuid, timestamptz, timestamptz, integer, integer, integer, boolean, integer, timestamptz, integer, boolean, text, text, text, text, text, timestamptz
) to authenticated;

grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.cancel_host_session(uuid) to authenticated;
