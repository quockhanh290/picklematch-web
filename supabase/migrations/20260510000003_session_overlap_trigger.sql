-- Migration: Add trigger to prevent overlapping confirmed sessions
-- Created: 2026-05-10

-- 1. Function to check for session overlaps
create or replace function public.check_session_overlap()
returns trigger
language plpgsql
security definer
as $$
declare
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_overlapping_session_id uuid;
begin
  -- Only check if status is 'confirmed'
  if NEW.status <> 'confirmed' then
    return NEW;
  end if;

  -- Get times for the session being joined
  select cs.start_time, cs.end_time into v_new_start, v_new_end
  from public.court_slots cs
  join public.sessions s on s.slot_id = cs.id
  where s.id = NEW.session_id;

  -- Look for confirmed overlaps
  select s.id into v_overlapping_session_id
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where 
    (
      -- Case A: User is a confirmed player in another session
      exists (
        select 1 from public.session_players sp 
        where sp.session_id = s.id 
          and sp.player_id = NEW.player_id 
          and sp.status = 'confirmed'
          and sp.session_id <> NEW.session_id -- Exclude current session
      )
      OR 
      -- Case B: User is the host of another session
      (s.host_id = NEW.player_id and s.id <> NEW.session_id)
    )
    and s.status <> 'cancelled'
    and (cs.start_time < v_new_end) 
    and (v_new_start < cs.end_time)
  limit 1;

  if v_overlapping_session_id is not null then
    raise exception 'Bạn đã có lịch đấu khác trùng vào thời gian này. Vui lòng kiểm tra lại.';
  end if;

  return NEW;
end;
$$;

-- 2. Attach trigger to session_players
drop trigger if exists tr_check_session_overlap on public.session_players;
create trigger tr_check_session_overlap
before insert or update on public.session_players
for each row
execute function public.check_session_overlap();

-- 3. Function to check for join request overlap
create or replace function public.check_join_request_overlap()
returns trigger
language plpgsql
security definer
as $$
declare
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_overlapping_session_id uuid;
begin
  -- Get times for the session being requested
  select cs.start_time, cs.end_time into v_new_start, v_new_end
  from public.court_slots cs
  join public.sessions s on s.slot_id = cs.id
  where s.id = NEW.match_id;

  -- Look for confirmed overlaps
  select s.id into v_overlapping_session_id
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where 
    (
      -- Case A: User is a confirmed player in another session
      exists (
        select 1 from public.session_players sp 
        where sp.session_id = s.id 
          and sp.player_id = NEW.player_id 
          and sp.status = 'confirmed'
      )
      OR 
      -- Case B: User is the host of another session
      (s.host_id = NEW.player_id)
    )
    and s.status <> 'cancelled'
    and s.id <> NEW.match_id
    and (cs.start_time < v_new_end) 
    and (v_new_start < cs.end_time)
  limit 1;

  if v_overlapping_session_id is not null then
    raise exception 'Bạn đã có lịch đấu khác trùng vào thời gian này. Vui lòng kiểm tra lại lịch trình.';
  end if;

  return NEW;
end;
$$;

-- 4. Attach trigger to join_requests
drop trigger if exists tr_check_join_request_overlap on public.join_requests;
create trigger tr_check_join_request_overlap
before insert or update on public.join_requests
for each row
execute function public.check_join_request_overlap();
