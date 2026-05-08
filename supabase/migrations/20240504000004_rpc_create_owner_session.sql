-- RPC for owners to create sessions with specialized management details
create or replace function public.create_owner_session(
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
  
  -- Specialized Owner Fields
  p_format_type text,
  p_sub_court_numbers integer[],
  p_is_unlimited boolean,
  p_format_metadata jsonb default '{}'::jsonb
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

  -- 1. Create the slot
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
    0, -- Owner sessions usually handle pricing via session fee
    'booked'
  )
  returning id into v_slot_id;

  -- 2. Create the base session
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
    court_id,
    is_owner_managed
  ) values (
    v_uid,
    v_slot_id,
    p_elo_min,
    p_elo_max,
    coalesce(p_is_ranked, true),
    case when p_is_unlimited then 999 else p_max_players end,
    'open',
    p_fill_deadline,
    p_total_cost,
    coalesce(p_require_approval, false),
    'confirmed', -- Always confirmed for owners
    p_court_id,
    true
  )
  returning id into v_session_id;

  -- 3. Create the specialized owner details
  insert into public.owner_sessions (
    id,
    court_id,
    format_type,
    sub_court_numbers,
    is_unlimited,
    custom_max_players,
    format_metadata
  ) values (
    v_session_id,
    p_court_id,
    p_format_type,
    p_sub_court_numbers,
    p_is_unlimited,
    p_max_players,
    p_format_metadata
  );

  -- 4. Automatically confirm owner as host player
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

grant execute on function public.create_owner_session to authenticated;
