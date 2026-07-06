alter table public.sessions
  add column if not exists pending_completion_marked_at timestamptz,
  add column if not exists completion_reminder_sent_at timestamptz;

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
    check (status in ('open', 'pending_completion', 'done', 'cancelled'));
exception
  when duplicate_object then null;
end $$;

create or replace function public.process_pending_session_completions(p_session_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_count integer := 0;
  rec record;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  for rec in
    with updated as (
      update public.sessions s
      set
        status = 'pending_completion',
        pending_completion_marked_at = coalesce(s.pending_completion_marked_at, now())
      from public.court_slots cs
      where s.slot_id = cs.id
        and s.status = 'open'
        and cs.end_time + interval '30 minutes' <= now()
        and (p_session_id is null or s.id = p_session_id)
      returning
        s.id,
        s.host_id,
        s.completion_reminder_sent_at,
        cs.court_id
    )
    select
      u.id,
      u.host_id,
      u.completion_reminder_sent_at,
      c.name as court_name
    from updated u
    left join public.courts c on c.id = u.court_id
  loop
    v_count := v_count + 1;

    if rec.completion_reminder_sent_at is null then
      insert into public.notifications (
        player_id,
        type,
        title,
        body,
        deep_link,
        is_read
      )
      values (
        rec.host_id,
        'session_pending_completion',
        'Kèo đã hết giờ',
        format('🏓 Kèo tại sân %s đã hết giờ! Bấm vào đây để xác nhận kết quả và đóng kèo.', coalesce(rec.court_name, 'PickleMatch VN')),
        '/session/' || rec.id,
        false
      );

      update public.sessions
      set completion_reminder_sent_at = now()
      where id = rec.id;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.submit_session_results(
  p_session_id uuid,
  p_results jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_result jsonb;
  v_player_id uuid;
  v_result_value text;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.host_id = v_uid
      and s.status in ('done', 'pending_completion')
  ) then
    raise exception 'Only the host of a completed or pending-completion session can submit results';
  end if;

  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Results payload must be an array';
  end if;

  for v_result in
    select * from jsonb_array_elements(p_results)
  loop
    v_player_id := (v_result ->> 'player_id')::uuid;
    v_result_value := coalesce(v_result ->> 'result', 'pending');

    if v_result_value not in ('pending', 'win', 'loss', 'draw') then
      raise exception 'Invalid result value: %', v_result_value;
    end if;

    update public.session_players sp
    set
      proposed_result = v_result_value,
      result_confirmation_status = case
        when sp.player_id = v_uid then 'confirmed'
        else 'awaiting_player'
      end,
      result_confirmed_at = case
        when sp.player_id = v_uid then now()
        else null
      end,
      result_disputed_at = null,
      result_dispute_note = null
    where sp.session_id = p_session_id
      and sp.player_id = v_player_id;
  end loop;

  update public.sessions
  set
    status = 'done',
    results_status = 'pending_confirmation',
    results_submitted_at = now(),
    results_confirmation_deadline = now() + interval '24 hours'
  where id = p_session_id;
end;
$$;

grant execute on function public.process_pending_session_completions(uuid) to authenticated, service_role;
