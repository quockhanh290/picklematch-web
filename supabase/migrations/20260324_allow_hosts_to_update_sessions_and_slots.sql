drop policy if exists "Hosts can update their own sessions" on public.sessions;
create policy "Hosts can update their own sessions"
on public.sessions
for update
to authenticated
using (host_id = auth.uid())
with check (host_id = auth.uid());

drop policy if exists "Hosts can update slots for their own sessions" on public.court_slots;
create policy "Hosts can update slots for their own sessions"
on public.court_slots
for update
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.slot_id = court_slots.id
      and sessions.host_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions
    where sessions.slot_id = court_slots.id
      and sessions.host_id = auth.uid()
  )
);
