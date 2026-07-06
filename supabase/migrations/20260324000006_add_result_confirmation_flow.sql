alter table public.sessions
  add column if not exists results_status text not null default 'not_submitted',
  add column if not exists results_submitted_at timestamptz,
  add column if not exists results_confirmation_deadline timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_results_status_check'
  ) then
    alter table public.sessions
      add constraint sessions_results_status_check
      check (results_status in ('not_submitted', 'pending_confirmation', 'disputed', 'finalized'));
  end if;
end $$;

alter table public.session_players
  add column if not exists proposed_result text not null default 'pending',
  add column if not exists result_confirmation_status text not null default 'not_submitted',
  add column if not exists result_confirmed_at timestamptz,
  add column if not exists result_disputed_at timestamptz,
  add column if not exists result_dispute_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_players_proposed_result_check'
  ) then
    alter table public.session_players
      add constraint session_players_proposed_result_check
      check (proposed_result in ('pending', 'win', 'loss', 'draw'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_players_result_confirmation_status_check'
  ) then
    alter table public.session_players
      add constraint session_players_result_confirmation_status_check
      check (result_confirmation_status in ('not_submitted', 'awaiting_player', 'confirmed', 'disputed'));
  end if;
end $$;

drop trigger if exists trg_session_done_achievements on public.sessions;

create or replace function public.finalize_session_results(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_session public.sessions%rowtype;
  v_pending_count integer := 0;
  v_disputed_count integer := 0;
  v_player_id uuid;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);

  select *
  into v_session
  from public.sessions
  where id = p_session_id;

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

  select count(*)::int
  into v_disputed_count
  from public.session_players
  where session_id = p_session_id
    and result_confirmation_status = 'disputed';

  if v_disputed_count > 0 then
    raise exception 'Session results are disputed and cannot be finalized';
  end if;

  select count(*)::int
  into v_pending_count
  from public.session_players
  where session_id = p_session_id
    and player_id <> v_session.host_id
    and result_confirmation_status <> 'confirmed';

  if v_pending_count > 0
     and (v_session.results_confirmation_deadline is null or v_session.results_confirmation_deadline > now()) then
    raise exception 'Session results are still awaiting confirmation';
  end if;

  update public.session_players
  set
    match_result = proposed_result,
    result_confirmation_status = 'confirmed',
    result_confirmed_at = coalesce(result_confirmed_at, now())
  where session_id = p_session_id;

  update public.sessions
  set results_status = 'finalized'
  where id = p_session_id;

  for v_player_id in
    select distinct player_id
    from public.session_players
    where session_id = p_session_id
      and status = 'confirmed'
  loop
    perform public.check_achievements(v_player_id);
  end loop;
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
      and s.status = 'done'
  ) then
    raise exception 'Only the host of a completed session can submit results';
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
    results_status = 'pending_confirmation',
    results_submitted_at = now(),
    results_confirmation_deadline = now() + interval '24 hours'
  where id = p_session_id;
end;
$$;

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

  update public.session_players
  set
    result_confirmation_status = p_response,
    result_confirmed_at = case when p_response = 'confirmed' then now() else result_confirmed_at end,
    result_disputed_at = case when p_response = 'disputed' then now() else result_disputed_at end,
    result_dispute_note = case when p_response = 'disputed' then nullif(trim(p_note), '') else null end
  where session_id = p_session_id
    and player_id = v_uid;

  if p_response = 'disputed' then
    update public.sessions
    set results_status = 'disputed'
    where id = p_session_id;

    return 'disputed';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id <> v_host_id
      and sp.result_confirmation_status <> 'confirmed'
  ) then
    perform public.finalize_session_results(p_session_id);
    return 'finalized';
  end if;

  if v_deadline is not null and v_deadline <= now() then
    perform public.finalize_session_results(p_session_id);
    return 'finalized';
  end if;

  return 'confirmed';
end;
$$;

grant execute on function public.submit_session_results(uuid, jsonb) to authenticated;
grant execute on function public.respond_to_session_result(uuid, text, text) to authenticated;
grant execute on function public.finalize_session_results(uuid) to authenticated, service_role;
