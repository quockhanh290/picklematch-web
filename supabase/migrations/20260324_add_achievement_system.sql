alter table public.session_players
  add column if not exists match_result text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_players_match_result_check'
  ) then
    alter table public.session_players
      add constraint session_players_match_result_check
      check (match_result in ('pending', 'win', 'loss', 'draw'));
  end if;
end $$;

create table if not exists public.player_stats (
  player_id uuid primary key references public.players(id) on delete cascade,
  total_matches integer not null default 0,
  total_wins integer not null default 0,
  current_win_streak integer not null default 0,
  max_win_streak integer not null default 0,
  last_match_at timestamptz,
  streak_fire_active boolean not null default false,
  streak_fire_level integer not null default 0,
  host_average_rating numeric(3,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.player_achievements (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  badge_key text not null,
  badge_title text not null,
  badge_category text not null,
  badge_description text,
  icon text,
  earned_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  unique (player_id, badge_key)
);

create index if not exists idx_player_achievements_player_id on public.player_achievements(player_id, earned_at desc);

alter table public.player_stats enable row level security;
alter table public.player_achievements enable row level security;

drop policy if exists "Players can view own stats" on public.player_stats;
create policy "Players can view own stats"
on public.player_stats
for select
to authenticated
using (player_id = auth.uid());

drop policy if exists "Players can view own achievements" on public.player_achievements;
create policy "Players can view own achievements"
on public.player_achievements
for select
to authenticated
using (player_id = auth.uid());

create or replace function public.send_push_notification(
  p_player_id uuid,
  p_title text,
  p_body text,
  p_type text default 'achievement_unlocked',
  p_deep_link text default '/(tabs)/profile'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (
    player_id,
    type,
    title,
    body,
    deep_link,
    is_read
  )
  values (
    p_player_id,
    p_type,
    p_title,
    p_body,
    p_deep_link,
    false
  );
end;
$$;

create or replace function public.sync_player_badge_array(
  p_player_id uuid,
  p_badge_title text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.players p
  set earned_badges = array(
    select distinct badge
    from unnest(coalesce(p.earned_badges, '{}'::text[]) || array[p_badge_title]) as badge
  )
  where p.id = p_player_id;
$$;

create or replace function public.handle_player_achievement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_player_badge_array(new.player_id, new.badge_title);

  perform public.send_push_notification(
    new.player_id,
    '🏆 Danh hiệu mới!',
    format('Chúc mừng! Bạn vừa đạt được danh hiệu %s. Hãy vào khoe ngay nào!', new.badge_title),
    'achievement_unlocked',
    '/(tabs)/profile'
  );

  return new;
end;
$$;

drop trigger if exists trg_player_achievement_insert on public.player_achievements;
create trigger trg_player_achievement_insert
after insert on public.player_achievements
for each row
execute function public.handle_player_achievement_insert();

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
    for rec in
      select sp.match_result
      from public.session_players sp
      join public.sessions s on s.id = sp.session_id
      join public.court_slots cs on cs.id = s.slot_id
      where sp.player_id = p_player_id
        and s.status = 'done'
        and sp.status = 'confirmed'
      order by cs.end_time desc, s.created_at desc
    loop
      if rec.match_result = 'win' then
        v_current_streak := v_current_streak + 1;
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

  for rec in
    select sp.match_result
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    join public.court_slots cs on cs.id = s.slot_id
    where sp.player_id = p_player_id
      and s.status = 'done'
      and sp.status = 'confirmed'
    order by cs.end_time asc, s.created_at asc
  loop
    if rec.match_result = 'win' then
      v_running_streak := v_running_streak + 1;
      v_max_streak := greatest(v_max_streak, v_running_streak);
    else
      v_running_streak := 0;
    end if;
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

create or replace function public.award_achievement(
  p_player_id uuid,
  p_badge_key text,
  p_badge_title text,
  p_badge_category text,
  p_badge_description text,
  p_icon text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_achievements (
    player_id,
    badge_key,
    badge_title,
    badge_category,
    badge_description,
    icon,
    meta
  )
  values (
    p_player_id,
    p_badge_key,
    p_badge_title,
    p_badge_category,
    p_badge_description,
    p_icon,
    coalesce(p_meta, '{}'::jsonb)
  )
  on conflict (player_id, badge_key) do nothing;
end;
$$;

create or replace function public.check_achievements(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_stats public.player_stats%rowtype;
  v_placement_wins integer := 0;
  v_placement_total integer := 0;
  v_has_giant_slayer boolean := false;
  v_host_positive_count integer := 0;
begin
  perform public.recompute_player_stats(p_player_id);

  select * into v_player
  from public.players
  where id = p_player_id;

  select * into v_stats
  from public.player_stats
  where player_id = p_player_id;

  if v_stats.last_match_at is not null and v_stats.last_match_at < now() - interval '14 days' then
    update public.player_stats
    set
      current_win_streak = 0,
      streak_fire_active = false,
      streak_fire_level = 0,
      updated_at = now()
    where player_id = p_player_id;

    select * into v_stats
    from public.player_stats
    where player_id = p_player_id;
  end if;

  if coalesce(v_stats.total_matches, 0) >= 20 then
    perform public.award_achievement(
      p_player_id,
      'active_member_20',
      'Hội viên tích cực',
      'progression',
      'Hoàn thành 20 trận pickleball trên PickleMatch.',
      'medal'
    );
  end if;

  if coalesce(v_stats.total_matches, 0) >= 100 then
    perform public.award_achievement(
      p_player_id,
      'court_warrior_100',
      'Chiến thần sân bãi',
      'progression',
      'Cán mốc 100 trận đã hoàn thành.',
      'crown'
    );
  end if;

  select exists (
    select 1
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    where sp.player_id = p_player_id
      and sp.match_result = 'win'
      and s.status = 'done'
      and coalesce(s.elo_min, 0) >= coalesce(v_player.current_elo, v_player.elo::integer, 0) + 100
  )
  into v_has_giant_slayer;

  if v_has_giant_slayer then
    perform public.award_achievement(
      p_player_id,
      'giant_slayer',
      'Giant Slayer',
      'performance',
      'Thắng một kèo có ngưỡng trình cao hơn bạn ít nhất 100 Elo.',
      'swords'
    );
  end if;

  select
    count(*) filter (where match_result = 'win')::int,
    count(*)::int
  into
    v_placement_wins,
    v_placement_total
  from (
    select sp.match_result
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    join public.court_slots cs on cs.id = s.slot_id
    where sp.player_id = p_player_id
      and s.status = 'done'
      and sp.status = 'confirmed'
    order by cs.end_time asc
    limit 5
  ) placement_results;

  if coalesce(v_player.placement_matches_played, 0) >= 5
     and v_placement_total = 5
     and v_placement_wins = 5 then
    perform public.award_achievement(
      p_player_id,
      'placement_perfect',
      'Tốt nghiệp xuất sắc',
      'performance',
      'Thắng 100% trong 5 trận placement đầu tiên.',
      'graduation'
    );
  end if;

  if coalesce(v_stats.current_win_streak, 0) >= 3 then
    perform public.award_achievement(
      p_player_id,
      'win_streak_3',
      'Win Streak 🔥',
      'momentum',
      'Đạt chuỗi thắng 3 trận liên tiếp.',
      'flame',
      jsonb_build_object('streak', v_stats.current_win_streak, 'level', v_stats.streak_fire_level)
    );
  end if;

  if coalesce(v_stats.current_win_streak, 0) >= 7 then
    perform public.award_achievement(
      p_player_id,
      'win_streak_7',
      'Bùng cháy chuỗi thắng',
      'momentum',
      'Đạt chuỗi thắng 7 trận liên tiếp.',
      'flame',
      jsonb_build_object('streak', v_stats.current_win_streak, 'level', v_stats.streak_fire_level)
    );
  end if;

  if coalesce(v_player.reliability_score, 100) = 100
     and coalesce(v_stats.last_match_at, now() - interval '100 days') >= now() - interval '30 days'
     and not exists (
       select 1
       from public.ratings r
       where r.rated_id = p_player_id
         and r.created_at >= now() - interval '30 days'
         and (
           r.no_show = true
           or coalesce(r.tags, '{}'::text[]) && array['late', 'toxic', 'dishonest']::text[]
         )
     ) then
    perform public.award_achievement(
      p_player_id,
      'swiss_clock',
      'Đồng hồ Thụy Sĩ',
      'conduct',
      'Giữ 100% độ tin cậy trong 30 ngày gần nhất.',
      'clock'
    );
  end if;

  select count(*)::int
  into v_host_positive_count
  from public.ratings r
  join public.sessions s on s.id = r.session_id
  where r.rated_id = p_player_id
    and s.host_id = p_player_id
    and coalesce(r.is_hidden, false) = false;

  if coalesce(v_stats.host_average_rating, 0) >= 4.9
     and v_host_positive_count >= 5 then
    perform public.award_achievement(
      p_player_id,
      'golden_host',
      'Host Vàng',
      'conduct',
      'Giữ điểm host trung bình từ 4.9 trở lên.',
      'shield'
    );
  end if;
end;
$$;

create or replace function public.handle_session_done_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  if new.status = 'done' and coalesce(old.status, '') <> 'done' then
    for v_player_id in
      select distinct player_id
      from public.session_players
      where session_id = new.id
        and status = 'confirmed'
    loop
      perform public.check_achievements(v_player_id);
    end loop;

    if not exists (
      select 1
      from public.session_players
      where session_id = new.id
        and player_id = new.host_id
        and status = 'confirmed'
    ) then
      perform public.check_achievements(new.host_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_session_done_achievements on public.sessions;
create trigger trg_session_done_achievements
after update of status on public.sessions
for each row
execute function public.handle_session_done_achievements();

grant execute on function public.send_push_notification(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.recompute_player_stats(uuid) to authenticated, service_role;
grant execute on function public.check_achievements(uuid) to authenticated, service_role;
grant execute on function public.award_achievement(uuid, text, text, text, text, text, jsonb) to service_role;
