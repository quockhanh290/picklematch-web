do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sessions_status_check'
  ) then
    alter table public.sessions drop constraint sessions_status_check;
  end if;

  alter table public.sessions
    add constraint sessions_status_check
    check (status in ('open', 'closed_recruitment', 'pending_completion', 'done', 'cancelled'));
exception
  when duplicate_object then null;
end $$;

create or replace function public.process_fill_deadline_session_closures(p_session_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_count integer := 0;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);

  if v_uid is null and coalesce(v_role, '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  with updated as (
    update public.sessions s
    set status = 'closed_recruitment'
    where s.status = 'open'
      and s.fill_deadline is not null
      and s.fill_deadline <= now()
      and (p_session_id is null or s.id = p_session_id)
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

create or replace function public.validate_join_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_fill_deadline timestamptz;
  v_host_id uuid;
  v_max_players integer;
  v_confirmed_count integer;
begin
  if tg_table_name = 'join_requests' then
    if new.status <> 'pending' then
      return new;
    end if;

    select s.status, s.fill_deadline
    into v_status, v_fill_deadline
    from public.sessions s
    where s.id = new.match_id;

    if v_status is null then
      raise exception 'Session not found';
    end if;

    if v_status <> 'open' then
      raise exception 'Session is not accepting new players';
    end if;

    if v_fill_deadline is not null and v_fill_deadline <= now() then
      update public.sessions
      set status = 'closed_recruitment'
      where id = new.match_id
        and status = 'open';
      raise exception 'Session has stopped accepting new players';
    end if;

    return new;
  end if;

  if tg_table_name = 'session_players' then
    if coalesce(new.status, '') <> 'confirmed' then
      return new;
    end if;

    select s.status, s.fill_deadline, s.host_id, s.max_players
    into v_status, v_fill_deadline, v_host_id, v_max_players
    from public.sessions s
    where s.id = new.session_id;

    if v_status is null then
      raise exception 'Session not found';
    end if;

    -- Always allow host self-row on create flow.
    if new.player_id = v_host_id then
      return new;
    end if;

    if v_status <> 'open' then
      raise exception 'Session is not accepting new players';
    end if;

    if v_fill_deadline is not null and v_fill_deadline <= now() then
      update public.sessions
      set status = 'closed_recruitment'
      where id = new.session_id
        and status = 'open';
      raise exception 'Session has stopped accepting new players';
    end if;

    select count(*)
    into v_confirmed_count
    from public.session_players sp
    where sp.session_id = new.session_id
      and sp.status = 'confirmed';

    if v_confirmed_count >= coalesce(v_max_players, 0) then
      raise exception 'Session is already full';
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_join_window_join_requests on public.join_requests;
create trigger trg_validate_join_window_join_requests
before insert or update on public.join_requests
for each row
execute function public.validate_join_window();

drop trigger if exists trg_validate_join_window_session_players on public.session_players;
create trigger trg_validate_join_window_session_players
before insert on public.session_players
for each row
execute function public.validate_join_window();

grant execute on function public.process_fill_deadline_session_closures(uuid) to authenticated, service_role;
