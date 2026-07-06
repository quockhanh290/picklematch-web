alter table public.session_audit_events
  add column if not exists client_event_id text;

create unique index if not exists idx_session_audit_events_client_event_id
  on public.session_audit_events(client_event_id);
