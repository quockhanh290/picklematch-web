create or replace function public.update_session_with_host(
  p_session_id uuid,
  p_court_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
  v_current_status text;
  v_confirmed_count integer;
  v_next_status text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.slot_id, s.status
  into v_slot_id, v_current_status
  from public.sessions s
  where s.id = p_session_id
    and s.host_id = v_uid
  for update;

  if v_slot_id is null then
    raise exception 'Session not found or not allowed';
  end if;

  if v_current_status in ('cancelled', 'done') then
    raise exception 'Session can not be edited in current status';
  end if;

  select count(*)
  into v_confirmed_count
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed';

  if p_fill_deadline is not null and p_fill_deadline <= now() then
    v_next_status := 'closed_recruitment';
  elsif v_confirmed_count >= coalesce(p_max_players, 0) then
    v_next_status := 'full';
  else
    v_next_status := 'open';
  end if;

  update public.court_slots
  set
    court_id = p_court_id,
    start_time = p_start_time,
    end_time = p_end_time,
    price = coalesce(p_total_cost, 0),
    status = 'booked'
  where id = v_slot_id;

  update public.sessions
  set
    elo_min = p_elo_min,
    elo_max = p_elo_max,
    is_ranked = coalesce(p_is_ranked, true),
    max_players = p_max_players,
    fill_deadline = p_fill_deadline,
    total_cost = p_total_cost,
    require_approval = coalesce(p_require_approval, false),
    court_booking_status = p_court_booking_status,
    booking_reference = nullif(trim(coalesce(p_booking_reference, '')), ''),
    booking_name = nullif(trim(coalesce(p_booking_name, '')), ''),
    booking_phone = nullif(trim(coalesce(p_booking_phone, '')), ''),
    booking_notes = nullif(trim(coalesce(p_booking_notes, '')), ''),
    booking_confirmed_at = p_booking_confirmed_at,
    status = v_next_status
  where id = p_session_id;

  return p_session_id;
end;
$$;

grant execute on function public.update_session_with_host(
  uuid, uuid, timestamptz, timestamptz, integer, integer, boolean, integer, timestamptz, integer, boolean, text, text, text, text, text, timestamptz
) to authenticated;
