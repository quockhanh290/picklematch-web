-- 1) Send host notifications whenever a player creates/reopens a pending join request.
-- 2) Allow fill-deadline closure processor to run from SQL editor/admin role
--    (no JWT context) in addition to authenticated/service_role contexts.

create or replace function public.notify_host_on_join_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_player_name text;
begin
  if tg_op = 'INSERT' and new.status <> 'pending' then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (new.status = 'pending' and old.status is distinct from new.status) then
    return new;
  end if;

  select s.host_id
  into v_host_id
  from public.sessions s
  where s.id = new.match_id;

  if v_host_id is null or v_host_id = new.player_id then
    return new;
  end if;

  select p.name
  into v_player_name
  from public.players p
  where p.id = new.player_id;

  insert into public.notifications (
    player_id,
    type,
    title,
    body,
    deep_link,
    is_read
  )
  values (
    v_host_id,
    'join_request',
    'Yeu cau tham gia moi',
    coalesce(v_player_name, 'Mot nguoi choi') || ' vua gui yeu cau tham gia keo cua ban.',
    '/session/' || new.match_id::text || '/review',
    false
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_host_on_join_request on public.join_requests;
create trigger trg_notify_host_on_join_request
after insert or update on public.join_requests
for each row
execute function public.notify_host_on_join_request();

create or replace function public.process_fill_deadline_session_closures(p_session_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_closed_count integer := 0;
  v_reopened_count integer := 0;
  v_db_role text;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);
  v_db_role := current_user;

  if v_uid is null
     and coalesce(v_role, '') <> 'service_role'
     and v_db_role not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Not authenticated';
  end if;

  with reopened as (
    update public.sessions s
    set status = 'open'
    where s.status = 'closed_recruitment'
      and s.fill_deadline is not null
      and s.fill_deadline > now()
      and (p_session_id is null or s.id = p_session_id)
    returning 1
  )
  select count(*) into v_reopened_count from reopened;

  with closed as (
    update public.sessions s
    set status = 'closed_recruitment'
    where s.status = 'open'
      and s.fill_deadline is not null
      and s.fill_deadline <= now()
      and (p_session_id is null or s.id = p_session_id)
    returning 1
  )
  select count(*) into v_closed_count from closed;

  return v_closed_count + v_reopened_count;
end;
$$;

grant execute on function public.process_fill_deadline_session_closures(uuid) to authenticated, service_role;

-- Ask PostgREST to refresh cached RPC signatures/triggers after migration.
select pg_notify('pgrst', 'reload schema');
