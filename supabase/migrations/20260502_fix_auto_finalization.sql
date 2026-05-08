-- Fix auto-finalization logic and enforce strict even-number player requirements
-- Logic: 
-- 1. If a session ends, the confirmed player count must be:
--    - At least 2.
--    - An even number (2, 4, etc.).
--    - Not exceeding the max_players setting.
-- 2. Anything else results in match cancellation.
-- 3. Sessions are finalized immediately once the last participant confirms.

-- Drop existing functions to allow return type changes
drop function if exists public.respond_to_session_result(uuid, text, text);
drop function if exists public.submit_session_results(uuid, jsonb);
drop function if exists public.finalize_session_results(uuid);

-- 1. Update respond_to_session_result
create or replace function public.respond_to_session_result(
  p_session_id uuid,
  p_response text,
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
  v_deadline timestamptz;
  v_updated_rows integer := 0;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select host_id, results_confirmation_deadline
  into v_host_id, v_deadline
  from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_uid = v_host_id then
    raise exception 'Host cannot use player confirmation flow';
  end if;

  if p_response not in ('confirmed', 'disputed') then
    raise exception 'Invalid response';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
      and sp.status = 'confirmed'
  ) then
    raise exception 'Only confirmed players can respond to session results';
  end if;

  update public.session_players
  set
    result_confirmation_status = p_response,
    result_confirmed_at = case when p_response = 'confirmed' then now() else result_confirmed_at end,
    result_disputed_at = case when p_response = 'disputed' then now() else result_disputed_at end,
    result_dispute_note = case when p_response = 'disputed' then nullif(trim(p_note), '') else null end
  where session_id = p_session_id
    and player_id = v_uid
    and status = 'confirmed';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 0 then
    raise exception 'Could not record your response for this session';
  end if;

  if p_response = 'disputed' then
    update public.sessions
    set results_status = 'disputed'
    where id = p_session_id;

    return 'disputed';
  end if;

  -- CHECK FOR FINALIZATION
  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id <> v_host_id
      and sp.status = 'confirmed'
      and coalesce(sp.result_confirmation_status, 'awaiting_player') <> 'confirmed'
  ) then
    return public.finalize_session_results(p_session_id);
  end if;

  -- Also finalize if the deadline has passed
  if v_deadline is not null and v_deadline <= now() then
    return public.finalize_session_results(p_session_id);
  end if;

  return 'confirmed';
end;
$$;

-- 2. Update submit_session_results
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
  v_final_status text;
  v_session record;
  v_confirmed_count int;
  v_is_valid_count boolean;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.* into v_session
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.host_id <> v_uid or v_session.status not in ('done', 'pending_completion', 'pending_results') then
    raise exception 'Only the host of a completed session can submit results';
  end if;

  -- ENFORCE PLAYER COUNT: Must be even and at least 2
  select count(*)::int
  into v_confirmed_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed';

  v_is_valid_count := (v_confirmed_count >= 2) and (v_confirmed_count % 2 = 0) and (v_confirmed_count <= v_session.max_players);

  if not v_is_valid_count then
    update public.sessions
    set
      status = 'cancelled',
      results_status = 'cancelled',
      elo_processed = true,
      elo_skip_reason = 'not_enough_players'
    where id = p_session_id;
    
    raise exception 'Kèo bị hủy do số lượng người chơi không hợp lệ (%)', v_confirmed_count;
  end if;

  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Results payload must be an array';
  end if;

  for v_result in
    select * from jsonb_array_elements(p_results)
  loop
    v_player_id := (v_result ->> 'player_id')::uuid;
    v_result_value := coalesce(v_result ->> 'result', 'pending');

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

  -- AUTO-FINALIZE CHECK
  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id <> v_uid
      and sp.status = 'confirmed'
      and coalesce(sp.result_confirmation_status, 'awaiting_player') <> 'confirmed'
  ) then
    v_final_status := public.finalize_session_results(p_session_id);
  end if;

  -- Notification logic
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

  if v_final_status is null or v_final_status = 'pending_confirmation' then
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
  end if;
end;
$$;

-- 3. Update finalize_session_results
create or replace function public.finalize_session_results(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_uid uuid;
  v_role text;
  v_disputed_count int;
  v_pending_count int;
  v_confirmed_player_count int;
  v_is_valid_count boolean;
begin
  v_uid := auth.uid();
  v_role := auth.role();

  select s.* into v_session
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if coalesce(v_role, '') <> 'service_role' and not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
  ) and v_session.host_id <> v_uid then
    raise exception 'You do not have access to finalize this session';
  end if;

  -- 1. Check for disputes
  select count(*)::int
  into v_disputed_count
  from public.session_players
  where session_id = p_session_id
    and result_confirmation_status = 'disputed';

  if v_disputed_count > 0 then
    raise exception 'Session results are disputed and cannot be finalized';
  end if;

  -- 2. Check for pending confirmations
  select count(*)::int
  into v_pending_count
  from public.session_players
  where session_id = p_session_id
    and player_id <> v_session.host_id
    and status = 'confirmed'
    and coalesce(result_confirmation_status, 'awaiting_player') <> 'confirmed';

  if v_pending_count > 0
     and (v_session.results_confirmation_deadline is null or v_session.results_confirmation_deadline > now()) then
    raise exception 'Session results are still awaiting confirmation';
  end if;

  -- 3. ENFORCE VALID PLAYER COUNT
  select count(*)::int
  into v_confirmed_player_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed';

  v_is_valid_count := (v_confirmed_player_count >= 2) and (v_confirmed_player_count % 2 = 0) and (v_confirmed_player_count <= v_session.max_players);

  if not v_is_valid_count then
    update public.sessions
    set
      status = 'cancelled',
      results_status = 'cancelled',
      elo_processed = true,
      elo_skip_reason = 'not_enough_players'
    where id = p_session_id;

    return 'cancelled';
  end if;

  -- 4. Transition to finalized
  update public.sessions
  set
    results_status = 'finalized',
    status = 'done',
    elo_processed = false
  where id = p_session_id;

  -- 5. Process Elo immediately
  begin
    perform public.process_match_elo(p_session_id);
  exception when others then
    -- Don't block finalization if Elo fails, but mark it
    update public.sessions 
    set elo_skip_reason = 'error: ' || SQLERRM
    where id = p_session_id;
  end;

  return 'finalized';
end;
$$;
