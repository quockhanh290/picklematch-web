-- Enable Row Level Security on core tables and define access policies.

-- 1. Players table
alter table public.players enable row level security;

drop policy if exists "Public profiles are viewable by everyone" on public.players;
create policy "Public profiles are viewable by everyone"
on public.players for select
using (true);

drop policy if exists "Users can update own profile" on public.players;
create policy "Users can update own profile"
on public.players for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 2. Sessions table
alter table public.sessions enable row level security;

drop policy if exists "Sessions are viewable by everyone" on public.sessions;
create policy "Sessions are viewable by everyone"
on public.sessions for select
using (true);

drop policy if exists "Authenticated users can create sessions" on public.sessions;
create policy "Authenticated users can create sessions"
on public.sessions for insert
to authenticated
with check (host_id = auth.uid());

drop policy if exists "Hosts can update their own sessions" on public.sessions;
create policy "Hosts can update their own sessions"
on public.sessions for update
to authenticated
using (host_id = auth.uid())
with check (host_id = auth.uid());

-- 3. Session Players table
alter table public.session_players enable row level security;

drop policy if exists "Participants are viewable by everyone" on public.session_players;
create policy "Participants are viewable by everyone"
on public.session_players for select
using (true);

-- Allow players to join sessions directly if we haven't migrated to RPC yet (backward compatibility)
-- but restrict to their own ID.
drop policy if exists "Players can join sessions" on public.session_players;
create policy "Players can join sessions"
on public.session_players for insert
to authenticated
with check (player_id = auth.uid());

drop policy if exists "Participants can leave or update their own status" on public.session_players;
create policy "Participants can leave or update their own status"
on public.session_players for delete
to authenticated
using (player_id = auth.uid());

-- 4. Courts and Court Slots (Read only for public)
alter table public.courts enable row level security;
drop policy if exists "Courts are viewable by everyone" on public.courts;
create policy "Courts are viewable by everyone"
on public.courts for select
using (true);

alter table public.court_slots enable row level security;
drop policy if exists "Court slots are viewable by everyone" on public.court_slots;
create policy "Court slots are viewable by everyone"
on public.court_slots for select
using (true);

-- 5. Ratings table
alter table public.ratings enable row level security;

drop policy if exists "Users can view ratings they received or gave" on public.ratings;
create policy "Users can view ratings they received or gave"
on public.ratings for select
to authenticated
using (
  rater_id = auth.uid() 
  or (rated_id = auth.uid() and is_hidden = false)
);

-- 6. Notifications table
alter table public.notifications enable row level security;

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
on public.notifications for select
to authenticated
using (player_id = auth.uid());

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications"
on public.notifications for update
to authenticated
using (player_id = auth.uid())
with check (player_id = auth.uid());
