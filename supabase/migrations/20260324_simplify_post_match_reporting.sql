alter table public.session_players
  add column if not exists host_unprofessional_reported_at timestamptz,
  add column if not exists host_unprofessional_report_note text;

create or replace function public.report_host_unprofessional(
  p_session_id uuid,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_host_id uuid;
  v_status text;
  v_auto_closed_at timestamptz;
  v_existing_report timestamptz;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.host_id, s.status, s.auto_closed_at
  into v_host_id, v_status, v_auto_closed_at
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_uid = v_host_id then
    raise exception 'Host cannot report their own session';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
      and sp.status = 'confirmed'
  ) then
    raise exception 'Only confirmed players can report the host';
  end if;

  if v_status <> 'pending_completion' and v_auto_closed_at is null then
    raise exception 'Host reporting only opens when the session is pending completion or auto-closed';
  end if;

  select sp.host_unprofessional_reported_at
  into v_existing_report
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.player_id = v_uid;

  if v_existing_report is not null then
    return 'already_reported';
  end if;

  update public.session_players
  set
    host_unprofessional_reported_at = now(),
    host_unprofessional_report_note = nullif(trim(p_note), '')
  where session_id = p_session_id
    and player_id = v_uid;

  update public.players
  set host_reputation = greatest(0, coalesce(host_reputation, 0) - 1)
  where id = v_host_id;

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
    'host_unprofessional_reported',
    'Host bi bao van hanh kem',
    'Mot nguoi choi da bao cao rang ban khong xac nhan ket qua dung han.',
    '/session/' || p_session_id,
    false
  );

  return 'reported';
end;
$$;

create or replace function public.report_session_outcome(
  p_session_id uuid,
  p_result text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Member result reporting has been retired. Host must submit results, and players can only report unprofessional host behavior.';
end;
$$;

grant execute on function public.report_host_unprofessional(uuid, text) to authenticated;
grant execute on function public.report_session_outcome(uuid, text, text) to authenticated;
