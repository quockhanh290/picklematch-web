-- Migration: Add update_owner_session RPC
-- Created: 2024-05-04
-- Purpose: Allow owners to update their sessions including specialized fields.

create or replace function public.update_owner_session(
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
  v_current_status text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Check ownership and session status
  select s.slot_id, s.status
  into v_slot_id, v_current_status
  from public.sessions s
  where s.id = p_session_id
    and s.host_id = v_uid
    and s.is_owner_managed = true
  for update;

  if v_slot_id is null then
    raise exception 'Session not found or not an owner session';
  end if;

  if v_current_status in ('cancelled', 'done') then
    raise exception 'Session cannot be edited in current status';
  end if;

  -- 2. Update the slot
  update public.court_slots
  set
    court_id = p_court_id,
    start_time = p_start_time,
    end_time = p_end_time,
    price = 0, -- Owner sessions handle pricing via total_cost in sessions
    status = 'booked'
  where id = v_slot_id;

  -- 3. Update the base session
  update public.sessions
  set
    elo_min = p_elo_min,
    elo_max = p_elo_max,
    is_ranked = coalesce(p_is_ranked, true),
    max_players = case when p_is_unlimited then 999 else p_max_players end,
    fill_deadline = p_fill_deadline,
    total_cost = p_total_cost,
    require_approval = coalesce(p_require_approval, false)
  where id = p_session_id;

  -- 4. Update the specialized owner details
  update public.owner_sessions
  set
    court_id = p_court_id,
    format_type = p_format_type,
    sub_court_numbers = p_sub_court_numbers,
    is_unlimited = p_is_unlimited,
    custom_max_players = p_max_players,
    format_metadata = p_format_metadata,
    require_results = p_require_results,
    
    -- Mirrored Fields
    elo_min = p_elo_min,
    elo_max = p_elo_max,
    total_cost = p_total_cost,
    require_approval = p_require_approval,
    start_time = p_start_time,
    end_time = p_end_time,
    max_players = p_max_players,
    
    -- Calculated Skill Points
    min_skill = public.elo_to_pvna(p_elo_min),
    max_skill = public.elo_to_pvna(p_elo_max)
  where id = p_session_id;

  return p_session_id;
end;
$$;

grant execute on function public.update_owner_session to authenticated;
