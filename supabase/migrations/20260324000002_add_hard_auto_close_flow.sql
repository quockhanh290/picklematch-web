alter table public.sessions
  add column if not exists auto_closed_at timestamptz,
  add column if not exists auto_closed_reason text;

create or replace function public.process_overdue_session_closures(p_session_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_count integer := 0;
  rec record;
  v_player_id uuid;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);

  if v_uid is null and coalesce(v_role, '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  for rec in
    with target_sessions as (
      select
        s.id,
        s.host_id,
        s.slot_id
      from public.sessions s
      join public.court_slots cs on cs.id = s.slot_id
      where s.status in ('open', 'pending_completion')
        and cs.end_time + interval '6 hours' <= now()
        and (p_session_id is null or s.id = p_session_id)
    ),
    session_updates as (
      update public.sessions s
      set
        status = 'done',
        results_status = 'finalized',
        results_submitted_at = coalesce(s.results_submitted_at, now()),
        results_confirmation_deadline = coalesce(s.results_confirmation_deadline, now()),
        pending_completion_marked_at = coalesce(s.pending_completion_marked_at, now()),
        auto_closed_at = now(),
        auto_closed_reason = 'timeout_no_host_completion'
      from target_sessions t
      where s.id = t.id
      returning s.id, s.host_id, t.slot_id
    )
    select
      su.id,
      su.host_id,
      c.name as court_name
    from session_updates su
    left join public.court_slots cs on cs.id = su.slot_id
    left join public.courts c on c.id = cs.court_id
  loop
    v_count := v_count + 1;

    update public.session_players
    set
      proposed_result = 'draw',
      match_result = 'draw',
      result_confirmation_status = 'confirmed',
      result_confirmed_at = coalesce(result_confirmed_at, now()),
      result_disputed_at = null,
      result_dispute_note = null
    where session_id = rec.id
      and status = 'confirmed';

    update public.players
    set reliability_score = greatest(0, coalesce(reliability_score, 100) - 3)
    where id = rec.host_id;

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
      'session_auto_closed',
      'Kèo đã được tự động đóng',
      format('Kèo tại sân %s đã được hệ thống tự động đóng do host chưa xác nhận kết quả đúng hạn.', coalesce(rec.court_name, 'PickleMatch VN')),
      '/session/' || rec.id,
      false
    );

    for v_player_id in
      select distinct player_id
      from public.session_players
      where session_id = rec.id
        and status = 'confirmed'
    loop
      insert into public.notifications (
        player_id,
        type,
        title,
        body,
        deep_link,
        is_read
      )
      values (
        v_player_id,
        'session_ready_for_rating',
        'Kèo đã hoàn tất',
        format('Kèo tại sân %s đã được đóng. Hãy vào đánh giá trận đấu và những người chơi khác.', coalesce(rec.court_name, 'PickleMatch VN')),
        '/session/' || rec.id,
        false
      );

      perform public.check_achievements(v_player_id);
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.process_overdue_session_closures(uuid) to authenticated, service_role;
