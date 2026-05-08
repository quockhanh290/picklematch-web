drop function if exists public.get_my_sessions_overview();

create or replace function public.get_my_sessions_overview()
returns table (
  id uuid,
  status text,
  court_booking_status text,
  role text,
  request_status text,
  start_time timestamptz,
  end_time timestamptz,
  court_name text,
  court_city text,
  court_address text,
  host_name text,
  player_count integer,
  max_players integer,
  elo_min integer,
  elo_max integer,
  has_rated boolean
)
language sql
security definer
set search_path = public
as $$
  with session_counts as (
    select
      sp.session_id,
      count(*) filter (where coalesce(sp.status, 'confirmed') <> 'rejected')::integer as player_count
    from public.session_players sp
    group by sp.session_id
  ),
  -- Host sessions WITHOUT pending join requests → upcoming tab
  host_sessions as (
    select
      s.id,
      s.status,
      s.court_booking_status,
      'host'::text as role,
      null::text as request_status,
      cs.start_time,
      cs.end_time,
      coalesce(c.name, 'Kèo Pickleball') as court_name,
      coalesce(c.city, '') as court_city,
      coalesce(c.address, '') as court_address,
      coalesce(p.name, 'Bạn') as host_name,
      coalesce(sc.player_count, 0) as player_count,
      coalesce(s.max_players, 0) as max_players,
      s.elo_min,
      s.elo_max,
      exists (select 1 from public.ratings r where r.session_id = s.id and r.rater_id = auth.uid()) as has_rated
    from public.sessions s
    left join public.court_slots cs on cs.id = s.slot_id
    left join public.courts c on c.id = cs.court_id
    left join public.players p on p.id = s.host_id
    left join session_counts sc on sc.session_id = s.id
    where s.host_id = auth.uid()
      and not exists (
        select 1 from public.join_requests jr
        where jr.match_id = s.id and jr.status = 'pending'
      )
  ),
  -- Host sessions WITH pending join requests → pending tab
  host_pending as (
    select
      s.id,
      s.status,
      s.court_booking_status,
      'host'::text as role,
      'pending'::text as request_status,
      cs.start_time,
      cs.end_time,
      coalesce(c.name, 'Kèo Pickleball') as court_name,
      coalesce(c.city, '') as court_city,
      coalesce(c.address, '') as court_address,
      coalesce(p.name, 'Bạn') as host_name,
      coalesce(sc.player_count, 0) as player_count,
      coalesce(s.max_players, 0) as max_players,
      s.elo_min,
      s.elo_max,
      exists (select 1 from public.ratings r where r.session_id = s.id and r.rater_id = auth.uid()) as has_rated
    from public.sessions s
    left join public.court_slots cs on cs.id = s.slot_id
    left join public.courts c on c.id = cs.court_id
    left join public.players p on p.id = s.host_id
    left join session_counts sc on sc.session_id = s.id
    where s.host_id = auth.uid()
      and exists (
        select 1 from public.join_requests jr
        where jr.match_id = s.id and jr.status = 'pending'
      )
  ),
  -- Player sessions (already accepted / confirmed in session)
  player_sessions as (
    select
      s.id,
      s.status,
      s.court_booking_status,
      'player'::text as role,
      coalesce(sp.status, 'confirmed') as request_status,
      cs.start_time,
      cs.end_time,
      coalesce(c.name, 'Kèo Pickleball') as court_name,
      coalesce(c.city, '') as court_city,
      coalesce(c.address, '') as court_address,
      coalesce(p.name, 'Ẩn danh') as host_name,
      coalesce(sc.player_count, 0) as player_count,
      coalesce(s.max_players, 0) as max_players,
      s.elo_min,
      s.elo_max,
      exists (select 1 from public.ratings r where r.session_id = s.id and r.rater_id = auth.uid()) as has_rated
    from public.session_players sp
    join public.sessions s on s.id = sp.session_id
    left join public.court_slots cs on cs.id = s.slot_id
    left join public.courts c on c.id = cs.court_id
    left join public.players p on p.id = s.host_id
    left join session_counts sc on sc.session_id = s.id
    where sp.player_id = auth.uid()
      and s.host_id <> auth.uid()
  ),
  -- Player pending join requests (not yet in session_players)
  pending_join_requests as (
    select
      s.id,
      s.status,
      s.court_booking_status,
      'player'::text as role,
      jr.status as request_status,
      cs.start_time,
      cs.end_time,
      coalesce(c.name, 'Kèo Pickleball') as court_name,
      coalesce(c.city, '') as court_city,
      coalesce(c.address, '') as court_address,
      coalesce(p.name, 'Ẩn danh') as host_name,
      coalesce(sc.player_count, 0) as player_count,
      coalesce(s.max_players, 0) as max_players,
      s.elo_min,
      s.elo_max,
      false as has_rated
    from public.join_requests jr
    join public.sessions s on s.id = jr.match_id
    left join public.court_slots cs on cs.id = s.slot_id
    left join public.courts c on c.id = cs.court_id
    left join public.players p on p.id = s.host_id
    left join session_counts sc on sc.session_id = s.id
    where jr.player_id = auth.uid()
      and jr.status = 'pending'
      and s.host_id <> auth.uid()
      and not exists (
        select 1 from public.session_players sp
        where sp.session_id = s.id and sp.player_id = jr.player_id
      )
  )
  select * from host_sessions
  union all
  select * from host_pending
  union all
  select * from player_sessions
  union all
  select * from pending_join_requests;
$$;

grant execute on function public.get_my_sessions_overview() to authenticated, service_role;
