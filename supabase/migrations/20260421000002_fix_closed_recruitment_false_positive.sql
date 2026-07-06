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
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);

  if v_uid is null and coalesce(v_role, '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  -- Safety net: reopen sessions incorrectly marked as closed_recruitment
  -- when their fill_deadline is still in the future.
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

  -- Normal flow: close sessions whose fill_deadline has passed.
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

-- One-shot repair for existing data.
update public.sessions
set status = 'open'
where status = 'closed_recruitment'
  and fill_deadline is not null
  and fill_deadline > now();
