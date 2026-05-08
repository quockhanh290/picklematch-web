-- Add require_results toggle to owner_sessions
ALTER TABLE public.owner_sessions ADD COLUMN IF NOT EXISTS require_results BOOLEAN DEFAULT false;

-- Add is_owner_managed flag to base sessions table
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_owner_managed BOOLEAN DEFAULT false;

-- Update the RPC to handle this new field
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
  p_format_metadata jsonb default '{}'::jsonb,
  p_require_results boolean default false
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

  -- 0. Ensure user exists in players table to satisfy foreign key for sessions
  insert into public.players (id, name, onboarding_completed)
  values (
    v_uid, 
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(auth.jwt() ->> 'email', '@', 1)),
    true
  )
  on conflict (id) do update 
  set onboarding_completed = true;

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
    0,
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
    'confirmed',
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
    format_metadata,
    require_results,
    
    -- Mirrored Fields
    elo_min,
    elo_max,
    total_cost,
    require_approval,
    start_time,
    end_time,
    max_players,
    min_skill,
    max_skill
  ) values (
    v_session_id,
    p_court_id,
    p_format_type,
    p_sub_court_numbers,
    p_is_unlimited,
    p_max_players,
    p_format_metadata,
    p_require_results,
    
    p_elo_min,
    p_elo_max,
    p_total_cost,
    p_require_approval,
    p_start_time,
    p_end_time,
    p_max_players,
    
    public.elo_to_pvna(p_elo_min),
    public.elo_to_pvna(p_elo_max)
  );

  return v_session_id;
end;
$$;

-- Fix existing sessions
UPDATE public.sessions s
SET is_owner_managed = true
FROM public.owner_sessions os
WHERE s.id = os.id;
