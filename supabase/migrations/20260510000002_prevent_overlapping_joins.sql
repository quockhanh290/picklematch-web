-- Migration: Prevent players from joining overlapping sessions
-- Created: 2026-05-10

create or replace function public.join_session(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_host_id uuid;
  v_max_players integer;
  v_confirmed_count integer;
  v_status text;
  v_fill_deadline timestamptz;
  v_existing_id uuid;
  
  -- Overlap check variables
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_overlapping_session_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Get new session times and lock for update
  select 
    s.host_id, s.max_players, s.status, s.fill_deadline,
    cs.start_time, cs.end_time
  into 
    v_host_id, v_max_players, v_status, v_fill_deadline,
    v_new_start, v_new_end
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where s.id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;

  -- 2. Check if already joined
  select player_id into v_existing_id
  from public.session_players
  where session_id = p_session_id
    and player_id = v_uid;

  if v_existing_id is not null then
    return v_uid; -- Already joined, return success.
  end if;

  -- 3. CHECK FOR OVERLAPS
  -- Check confirmed participations or hosting duties
  select s.id into v_overlapping_session_id
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where 
    (
      -- Case A: User is a confirmed player
      exists (
        select 1 from public.session_players sp 
        where sp.session_id = s.id 
          and sp.player_id = v_uid 
          and sp.status = 'confirmed'
      )
      OR 
      -- Case B: User is the host
      s.host_id = v_uid
    )
    and s.status <> 'cancelled'
    and s.id <> p_session_id
    and (cs.start_time < v_new_end) 
    and (v_new_start < cs.end_time)
  limit 1;

  if v_overlapping_session_id is not null then
    raise exception 'Bạn đã có một lịch đấu khác trùng vào thời gian này. Vui lòng kiểm tra lại lịch trình.';
  end if;

  -- 4. Check status and deadline
  if v_status <> 'open' then
    raise exception 'Kèo này hiện không chấp nhận người chơi mới';
  end if;

  if v_fill_deadline is not null and v_fill_deadline <= now() then
    raise exception 'Đã hết thời hạn tham gia kèo này';
  end if;

  -- 5. Check capacity
  select count(*)
  into v_confirmed_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed';

  if v_confirmed_count >= coalesce(v_max_players, 0) then
    raise exception 'Kèo đã đầy người';
  end if;

  -- 6. Insert participant
  insert into public.session_players (
    session_id,
    player_id,
    status
  ) values (
    p_session_id,
    v_uid,
    'confirmed'
  );

  -- 7. Clean up/Update join request if it exists
  update public.join_requests
  set status = 'accepted'
  where match_id = p_session_id
    and player_id = v_uid
    and status = 'pending';

  return v_uid;
end;
$$;
