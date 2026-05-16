create table if not exists public.suggester_decision_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int,
  event_type text not null,
  event_source text not null check (event_source in ('engine', 'host', 'system')),
  actor_id uuid references auth.users(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (round_no is null or round_no >= 0),
  check (jsonb_typeof(payload) = 'object')
);

comment on table public.suggester_decision_events is
  'Append-only audit trail for live-session suggester decisions, host overrides, roster changes, and round outcomes.';

create index if not exists idx_suggester_decision_events_session_round
  on public.suggester_decision_events(session_id, round_no, created_at);

create index if not exists idx_suggester_decision_events_session_type
  on public.suggester_decision_events(session_id, event_type, created_at);

alter table public.suggester_decision_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggester_decision_events'
      and policyname = 'Hosts can read suggester decision events'
  ) then
    create policy "Hosts can read suggester decision events"
      on public.suggester_decision_events
      for select
      using (
        exists (
          select 1
          from public.sessions s
          where s.id = suggester_decision_events.session_id
            and s.host_id = auth.uid()
        )
      );
  end if;
end $$;
