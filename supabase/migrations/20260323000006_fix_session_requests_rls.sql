drop policy if exists "Players can manage their own session requests" on public.session_requests;
drop policy if exists "Hosts can view requests for their own sessions" on public.session_requests;
drop policy if exists "Hosts can update requests for their own sessions" on public.session_requests;
drop policy if exists "Hosts can delete requests for their own sessions" on public.session_requests;

create policy "Players can manage their own session requests"
on public.session_requests
for all
to authenticated
using (player_id = auth.uid())
with check (player_id = auth.uid());

create policy "Hosts can view requests for their own sessions"
on public.session_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = session_requests.session_id
      and sessions.host_id = auth.uid()
  )
);

create policy "Hosts can update requests for their own sessions"
on public.session_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = session_requests.session_id
      and sessions.host_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions
    where sessions.id = session_requests.session_id
      and sessions.host_id = auth.uid()
  )
);

create policy "Hosts can delete requests for their own sessions"
on public.session_requests
for delete
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = session_requests.session_id
      and sessions.host_id = auth.uid()
  )
);
