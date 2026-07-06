alter table public.sessions
  add column if not exists finalized_by text,
  add column if not exists ghost_session_reported_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sessions_results_status_check'
  ) then
    alter table public.sessions drop constraint sessions_results_status_check;
  end if;

  alter table public.sessions
    add constraint sessions_results_status_check
    check (results_status in ('not_submitted', 'pending_confirmation', 'disputed', 'finalized', 'void'));
exception
  when duplicate_object then null;
end $$;

alter table public.session_players
  add column if not exists member_reported_result text not null default 'pending',
  add column if not exists member_reported_at timestamptz,
  add column if not exists member_report_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_players_member_reported_result_check'
  ) then
    alter table public.session_players
      add constraint session_players_member_reported_result_check
      check (member_reported_result in ('pending', 'win', 'loss', 'draw', 'not_played'));
  end if;
end $$;

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
declare
  v_uid uuid;
  v_host_id uuid;
  v_end_time timestamptz;
  v_total_non_host integer := 0;
  v_quorum integer := 0;
  v_reported_count integer := 0;
  v_not_played_count integer := 0;
  v_player_id uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_result not in ('win', 'loss', 'draw', 'not_played') then
    raise exception 'Invalid reported result';
  end if;

  select s.host_id, cs.end_time
  into v_host_id, v_end_time
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_uid = v_host_id then
    raise exception 'Host cannot use member result reporting';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
      and sp.status = 'confirmed'
  ) then
    raise exception 'Only confirmed players can report session outcome';
  end if;

  if v_end_time + interval '30 minutes' > now() then
    raise exception 'Member result reporting opens 30 minutes after session end time';
  end if;

  update public.session_players
  set
    member_reported_result = p_result,
    member_reported_at = now(),
    member_report_note = nullif(trim(p_note), '')
  where session_id = p_session_id
    and player_id = v_uid;

  select count(*)::int
  into v_total_non_host
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed'
    and player_id <> v_host_id;

  v_quorum := greatest(2, ceil(v_total_non_host * 2.0 / 3.0)::int);

  select count(*)::int
  into v_not_played_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed'
    and player_id <> v_host_id
    and member_reported_result = 'not_played';

  if v_not_played_count >= v_quorum then
    update public.sessions
    set
      status = 'cancelled',
      results_status = 'void',
      ghost_session_reported_at = now(),
      finalized_by = 'players'
    where id = p_session_id;

    update public.players
    set reliability_score = greatest(0, coalesce(reliability_score, 100) - 12)
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
      'ghost_session_voided',
      'Kèo bị đánh dấu không diễn ra',
      'Đa số người chơi đã báo trận đấu không diễn ra. Kèo đã bị vô hiệu và uy tín host bị trừ mạnh.',
      '/session/' || p_session_id,
      false
    );

    return 'ghost_voided';
  end if;

  select count(*)::int
  into v_reported_count
  from public.session_players
  where session_id = p_session_id
    and status = 'confirmed'
    and player_id <> v_host_id
    and member_reported_result in ('win', 'loss', 'draw');

  if v_reported_count >= v_quorum then
    update public.session_players
    set
      proposed_result = case
        when member_reported_result in ('win', 'loss', 'draw') then member_reported_result
        else proposed_result
      end,
      match_result = case
        when member_reported_result in ('win', 'loss', 'draw') then member_reported_result
        else coalesce(match_result, 'draw')
      end,
      result_confirmation_status = 'confirmed',
      result_confirmed_at = coalesce(result_confirmed_at, now())
    where session_id = p_session_id
      and status = 'confirmed';

    update public.session_players
    set
      proposed_result = 'draw',
      match_result = 'draw',
      result_confirmation_status = 'confirmed',
      result_confirmed_at = coalesce(result_confirmed_at, now())
    where session_id = p_session_id
      and player_id = v_host_id;

    update public.sessions
    set
      status = 'done',
      results_status = 'finalized',
      results_submitted_at = coalesce(results_submitted_at, now()),
      results_confirmation_deadline = coalesce(results_confirmation_deadline, now()),
      finalized_by = 'players'
    where id = p_session_id;

    update public.players
    set reliability_score = greatest(0, coalesce(reliability_score, 100) - 2)
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
      'session_member_consensus',
      'Người chơi đã chốt kết quả',
      'Kèo đã được đóng bằng đồng thuận của người chơi vì host chưa xác nhận đúng hạn.',
      '/session/' || p_session_id,
      false
    );

    for v_player_id in
      select distinct player_id
      from public.session_players
      where session_id = p_session_id
        and status = 'confirmed'
    loop
      perform public.check_achievements(v_player_id);
    end loop;

    return 'member_finalized';
  end if;

  return 'reported';
end;
$$;

grant execute on function public.report_session_outcome(uuid, text, text) to authenticated;
