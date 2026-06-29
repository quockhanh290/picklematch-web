create table if not exists board_stuck_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  session_id text,
  stuck_kind text,        -- '546' | 'latch' | 'incomplete' | 'stale' | 'unknown'
  court_idxs jsonb,       -- sân đang kẹt
  duration_ms int,        -- spinner/suggesting kéo dài bao lâu
  resolved_by text,       -- 'auto' | 'refresh' | 'complete_match' | 'unresolved'
  detail jsonb
);

alter table board_stuck_events enable row level security;

create policy "authenticated_insert_board_stuck_events"
  on board_stuck_events for insert
  to authenticated
  with check (true);
