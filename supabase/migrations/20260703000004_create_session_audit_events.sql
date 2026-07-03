create table if not exists public.session_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  event_type text not null,
  edge_function text,
  request_id text,
  client_request_id text,
  actor_id uuid,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists idx_session_audit_events_session_created
  on public.session_audit_events(session_id, created_at, id);

create index if not exists idx_session_audit_events_request_id
  on public.session_audit_events(request_id);

alter table public.session_audit_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_audit_events'
      and policyname = 'authenticated_insert_session_audit_events'
  ) then
    create policy "authenticated_insert_session_audit_events"
      on public.session_audit_events for insert
      to authenticated
      with check (true);
  end if;
end;
$$;
