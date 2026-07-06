alter table public.players
  add column if not exists auto_accept boolean not null default false;

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  match_id uuid not null references public.sessions(id) on delete cascade,
  status text not null default 'pending',
  intro_note text,
  host_response_template text,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'join_requests_status_check'
  ) then
    alter table public.join_requests
      add constraint join_requests_status_check
      check (status in ('pending', 'accepted', 'rejected'));
  end if;
end $$;

alter table public.join_requests enable row level security;

drop policy if exists "Players can manage their own join requests" on public.join_requests;
drop policy if exists "Hosts can view join requests for their matches" on public.join_requests;
drop policy if exists "Hosts can update join requests for their matches" on public.join_requests;
drop policy if exists "Hosts can delete join requests for their matches" on public.join_requests;

create policy "Players can manage their own join requests"
on public.join_requests
for all
to authenticated
using (player_id = auth.uid())
with check (player_id = auth.uid());

create policy "Hosts can view join requests for their matches"
on public.join_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = join_requests.match_id
      and sessions.host_id = auth.uid()
  )
);

create policy "Hosts can update join requests for their matches"
on public.join_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = join_requests.match_id
      and sessions.host_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions
    where sessions.id = join_requests.match_id
      and sessions.host_id = auth.uid()
  )
);

create policy "Hosts can delete join requests for their matches"
on public.join_requests
for delete
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = join_requests.match_id
      and sessions.host_id = auth.uid()
  )
);
