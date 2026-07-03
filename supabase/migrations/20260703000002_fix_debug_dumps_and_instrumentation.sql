alter table public.debug_dumps
  add column if not exists chosen_matches jsonb,
  add column if not exists pvna_tolerance numeric,
  add column if not exists rounds jsonb;

create table if not exists public.engine_instrumentation (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  session_id text,
  event text,
  detail text,
  court_count int,
  available int
);

alter table public.engine_instrumentation enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'engine_instrumentation'
      and policyname = 'authenticated_insert_engine_instrumentation'
  ) then
    create policy "authenticated_insert_engine_instrumentation"
      on public.engine_instrumentation for insert
      to authenticated
      with check (true);
  end if;
end;
$$;
