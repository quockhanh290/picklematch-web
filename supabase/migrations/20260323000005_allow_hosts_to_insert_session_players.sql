create policy "Hosts can add players to their own sessions"
on public.session_players
for insert
to authenticated
with check (
  exists (
    select 1
    from public.sessions
    where sessions.id = session_players.session_id
      and sessions.host_id = auth.uid()
  )
);
