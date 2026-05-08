create or replace function public.recompute_player_stats(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_matches integer := 0;
  v_total_wins integer := 0;
  v_current_streak integer := 0;
  v_max_streak integer := 0;
  v_running_streak integer := 0;
  v_last_match_at timestamptz;
  v_fire_active boolean := false;
  v_fire_level integer := 0;
  v_host_positive integer := 0;
  v_host_negative integer := 0;
  v_host_average numeric(3,2) := 0;
  v_previous_played_day date;
  rec record;
begin
  select
    count(*)::int,
    count(*) filter (where sp.match_result = 'win')::int,
    max(cs.end_time)
  into
    v_total_matches,
    v_total_wins,
    v_last_match_at
  from public.session_players sp
  join public.sessions s on s.id = sp.session_id
  join public.court_slots cs on cs.id = s.slot_id
  where sp.player_id = p_player_id
    and s.status = 'done'
    and sp.status = 'confirmed';

  if v_last_match_at is null or v_last_match_at < now() - interval '14 days' then
    v_current_streak := 0;
    v_fire_active := false;
    v_fire_level := 0;
  else
    v_previous_played_day := null;

    for rec in
      select distinct (cs.end_time at time zone 'Asia/Ho_Chi_Minh')::date as played_day
      from public.session_players sp
      join public.sessions s on s.id = sp.session_id
      join public.court_slots cs on cs.id = s.slot_id
      where sp.player_id = p_player_id
        and s.status = 'done'
        and sp.status = 'confirmed'
      order by played_day desc
    loop
      if v_previous_played_day is null then
        v_current_streak := 1;
        v_previous_played_day := rec.played_day;
      elsif rec.played_day = v_previous_played_day - 1 then
        v_current_streak := v_current_streak + 1;
        v_previous_played_day := rec.played_day;
      else
        exit;
      end if;
    end loop;

    v_fire_active := v_current_streak >= 3;
    v_fire_level := case
      when v_current_streak >= 7 then 2
      when v_current_streak >= 3 then 1
      else 0
    end;
  end if;

  v_previous_played_day := null;
  v_running_streak := 0;

  for rec in
    select distinct (cs.end_time at time zone 'Asia/Ho_Chi_Minh')::date as played_day
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    join public.court_slots cs on cs.id = s.slot_id
    where sp.player_id = p_player_id
      and s.status = 'done'
      and sp.status = 'confirmed'
    order by played_day asc
  loop
    if v_previous_played_day is null then
      v_running_streak := 1;
    elsif rec.played_day = v_previous_played_day + 1 then
      v_running_streak := v_running_streak + 1;
    else
      v_running_streak := 1;
    end if;

    v_max_streak := greatest(v_max_streak, v_running_streak);
    v_previous_played_day := rec.played_day;
  end loop;

  select
    coalesce(sum(
      case when coalesce(r.tags, '{}'::text[]) && array['good_description', 'well_organized', 'fair_pairing']::text[]
        then 1 else 0 end
    ), 0)::int,
    coalesce(sum(
      case when coalesce(r.tags, '{}'::text[]) && array['court_mismatch', 'poor_organization']::text[]
        then 1 else 0 end
    ), 0)::int
  into
    v_host_positive,
    v_host_negative
  from public.ratings r
  join public.sessions s on s.id = r.session_id
  where r.rated_id = p_player_id
    and s.host_id = p_player_id
    and coalesce(r.is_hidden, false) = false;

  if (v_host_positive + v_host_negative) > 0 then
    v_host_average := round((5.0 * v_host_positive / greatest(1, v_host_positive + v_host_negative))::numeric, 2);
  end if;

  insert into public.player_stats (
    player_id,
    total_matches,
    total_wins,
    current_win_streak,
    max_win_streak,
    last_match_at,
    streak_fire_active,
    streak_fire_level,
    host_average_rating,
    updated_at
  )
  values (
    p_player_id,
    v_total_matches,
    v_total_wins,
    v_current_streak,
    v_max_streak,
    v_last_match_at,
    v_fire_active,
    v_fire_level,
    v_host_average,
    now()
  )
  on conflict (player_id) do update
  set
    total_matches = excluded.total_matches,
    total_wins = excluded.total_wins,
    current_win_streak = excluded.current_win_streak,
    max_win_streak = excluded.max_win_streak,
    last_match_at = excluded.last_match_at,
    streak_fire_active = excluded.streak_fire_active,
    streak_fire_level = excluded.streak_fire_level,
    host_average_rating = excluded.host_average_rating,
    updated_at = now();
end;
$$;
