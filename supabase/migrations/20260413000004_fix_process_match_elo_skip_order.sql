create or replace function public.process_match_elo(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_is_internal boolean := false;
  v_session_id uuid;
  v_is_ranked boolean := true;
  v_confirmed_count integer := 0;
  v_team_ready_count integer := 0;
  v_win_count integer := 0;
  v_loss_count integer := 0;
  v_draw_count integer := 0;
  v_winner_team smallint;
  v_winner_team_count integer := 0;
  v_loser_team_count integer := 0;
  v_floor constant integer := 800;
  v_ceiling constant integer := 2000;
  v_required_players constant integer := 4;
  v_players_per_team constant integer := 2;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claim.role', true);
  v_is_internal := coalesce(v_role, '') = 'service_role' or current_user in ('postgres', 'supabase_admin');

  if v_uid is null and not v_is_internal then
    raise exception 'Not authenticated';
  end if;

  if not v_is_internal and not exists (
    select 1
    from public.sessions s
    left join public.session_players sp on sp.session_id = s.id and sp.player_id = v_uid
    where s.id = p_session_id
      and (s.host_id = v_uid or sp.player_id is not null)
  ) then
    raise exception 'You do not have access to process Elo for this session';
  end if;

  begin
    select s.id, s.is_ranked
    into v_session_id, v_is_ranked
    from public.sessions s
    where s.id = p_session_id
      and s.results_status = 'finalized'
      and coalesce(s.elo_processed, false) = false
    for update nowait;
  exception
    when lock_not_available then
      return 'busy';
  end;

  if v_session_id is null then
    return 'not_eligible';
  end if;

  if coalesce(v_is_ranked, true) = false then
    return 'not_eligible';
  end if;

  select
    count(*) filter (where sp.status = 'confirmed'),
    count(*) filter (where sp.status = 'confirmed' and sp.team_no is not null),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'win'),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'loss'),
    count(*) filter (where sp.status = 'confirmed' and sp.match_result = 'draw')
  into
    v_confirmed_count,
    v_team_ready_count,
    v_win_count,
    v_loss_count,
    v_draw_count
  from public.session_players sp
  where sp.session_id = p_session_id;

  if v_draw_count > 0 then
    -- v1: draw skipped. v2 candidate: process with S = 0.5
    update public.sessions
    set elo_skip_reason = 'skipped_draw_result'
    where id = p_session_id;
    return 'skipped_draw_result';
  end if;

  if v_confirmed_count <> v_required_players or v_team_ready_count <> v_required_players then
    update public.sessions
    set elo_skip_reason = 'skipped_insufficient_players'
    where id = p_session_id;
    return 'skipped_insufficient_players';
  end if;

  select min(sp.team_no), count(distinct sp.team_no)
  into v_winner_team, v_winner_team_count
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.match_result = 'win';

  select count(distinct sp.team_no)
  into v_loser_team_count
  from public.session_players sp
  where sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.match_result = 'loss';

  if v_win_count <> v_players_per_team
     or v_loss_count <> v_players_per_team
     or v_winner_team is null
     or v_winner_team_count <> 1
     or v_loser_team_count <> 1
     or exists (
       select 1
       from public.session_players sp
       where sp.session_id = p_session_id
         and sp.status = 'confirmed'
         and (
           sp.match_result not in ('win', 'loss')
           or (sp.match_result = 'win' and sp.team_no <> v_winner_team)
           or (sp.match_result = 'loss' and sp.team_no = v_winner_team)
         )
     ) then
    update public.sessions
    set elo_skip_reason = 'skipped_inconsistent_team'
    where id = p_session_id;
    return 'skipped_inconsistent_team';
  end if;

  update public.session_players sp
  set elo_snapshot = coalesce(p.current_elo, p.elo, 1000)
  from public.players p
  where sp.player_id = p.id
    and sp.session_id = p_session_id
    and sp.status = 'confirmed'
    and sp.elo_snapshot is null;

  with player_base as (
    select
      sp.player_id,
      sp.team_no,
      sp.match_result,
      sp.elo_snapshot as elo_before,
      coalesce(p.elo_matches_played, 0) as matches_played_at_time
    from public.session_players sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
      and sp.status = 'confirmed'
  ),
  team_avgs as (
    select
      pb.team_no,
      avg(pb.elo_before::numeric) as team_avg_elo
    from player_base pb
    group by pb.team_no
  ),
  calc as (
    select
      pb.player_id,
      pb.elo_before,
      pb.matches_played_at_time,
      case
        when pb.matches_played_at_time < 10 then 40
        when pb.matches_played_at_time < 30 then 24
        else 16
      end as k_factor,
      case when pb.match_result = 'win' then 1.0::numeric else 0.0::numeric end as actual_score,
      round(opponent.team_avg_elo)::integer as opponent_avg_elo,
      1.0::numeric / (
        1.0::numeric + power(10::numeric, (opponent.team_avg_elo - mine.team_avg_elo) / 400.0::numeric)
      ) as expected_score_raw
    from player_base pb
    join team_avgs mine on mine.team_no = pb.team_no
    join team_avgs opponent on opponent.team_no <> pb.team_no
  ),
  final_values as (
    select
      calc.player_id,
      calc.elo_before,
      calc.matches_played_at_time,
      calc.k_factor,
      round(calc.expected_score_raw, 3) as expected_score,
      calc.actual_score,
      calc.opponent_avg_elo,
      round(calc.k_factor * (calc.actual_score - calc.expected_score_raw))::integer as delta,
      least(v_ceiling, greatest(v_floor, calc.elo_before + round(calc.k_factor * (calc.actual_score - calc.expected_score_raw))::integer)) as new_elo
    from calc
  ),
  updated_players as (
    update public.players p
    set
      current_elo = fv.new_elo,
      elo = fv.new_elo,
      elo_matches_played = coalesce(p.elo_matches_played, 0) + 1
    from final_values fv
    where p.id = fv.player_id
    returning
      p.id as player_id,
      fv.elo_before,
      fv.new_elo,
      fv.delta,
      fv.k_factor,
      fv.expected_score,
      fv.actual_score,
      fv.opponent_avg_elo,
      fv.matches_played_at_time
  )
  insert into public.elo_history (
    player_id,
    session_id,
    elo_before,
    elo_after,
    delta,
    k_factor,
    expected_score,
    actual_score,
    opponent_avg_elo,
    matches_played_at_time,
    source,
    created_at
  )
  select
    up.player_id,
    p_session_id,
    up.elo_before,
    up.new_elo,
    up.delta,
    up.k_factor,
    up.expected_score,
    up.actual_score,
    up.opponent_avg_elo,
    up.matches_played_at_time,
    'match_result',
    now()
  from updated_players up;

  update public.sessions
  set
    elo_processed = true,
    elo_skip_reason = null
  where id = p_session_id;

  return 'processed';
end;
$$;

grant execute on function public.process_match_elo(uuid) to authenticated, service_role;
