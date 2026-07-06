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
  v_host_name text;
  v_court_name text;
  v_deep_link text;
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

  v_deep_link := '/session/' || p_session_id || '/confirm-result';

  select p.name, c.name
  into v_host_name, v_court_name
  from public.sessions s
  join public.players p on p.id = s.host_id
  join public.court_slots cs on cs.id = s.slot_id
  join public.courts c on c.id = cs.court_id
  where s.id = p_session_id;

  delete from public.notifications n
  where n.type = 'result_confirmation_request'
    and n.deep_link = v_deep_link
    and n.player_id in (
      select sp.player_id
      from public.session_players sp
      where sp.session_id = p_session_id
        and sp.status = 'confirmed'
        and sp.player_id <> v_uid
    );

  insert into public.notifications (
    player_id,
    type,
    title,
    body,
    deep_link,
    is_read
  )
  select
    sp.player_id,
    'result_confirmation_request',
    'Chờ bạn xác nhận kết quả',
    format(
      '%s đã gửi kết quả trận tại sân %s. Mở thông báo để xác nhận hoặc tranh chấp nếu cần.',
      coalesce(v_host_name, 'Chủ kèo'),
      coalesce(v_court_name, 'PickleMatch VN')
    ),
    v_deep_link,
    false
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.player_id <> v_uid;
end;
$$;

grant execute on function public.submit_session_results(uuid, jsonb) to authenticated;
