-- Live-match RPCs append audit rows as the host. The audit table only had a
-- read policy, so host inserts through PostgREST/RPC can be rejected by RLS.

alter table public.suggester_decision_events
  alter column event_source set default 'host',
  alter column actor_id set default auth.uid();

drop policy if exists "Hosts can insert suggester decision events" on public.suggester_decision_events;
create policy "Hosts can insert suggester decision events"
on public.suggester_decision_events
for insert
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = suggester_decision_events.session_id
      and s.host_id = auth.uid()
  )
);

notify pgrst, 'reload schema';
