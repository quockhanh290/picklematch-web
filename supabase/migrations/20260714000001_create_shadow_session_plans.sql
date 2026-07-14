create table if not exists public.session_plan_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  requested_by uuid not null,
  live_state_version bigint not null,
  input_hash text not null,
  engine_version text not null,
  roster_fingerprint text not null,
  config_fingerprint text not null,
  planned_round_count int not null check (planned_round_count > 0),
  court_count int not null check (court_count > 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'checkpointed', 'completed', 'failed', 'stale', 'cancelled')),
  input_payload jsonb not null,
  checkpoint jsonb,
  runtime_summary jsonb not null default '{}'::jsonb,
  error_detail jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (session_id, live_state_version, input_hash, engine_version),
  unique (id, session_id)
);

create table if not exists public.session_plan_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  session_id uuid not null,
  live_state_version bigint not null,
  input_hash text not null,
  plan_hash text not null,
  engine_version text not null,
  quality_summary jsonb not null default '{}'::jsonb,
  runtime_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id),
  unique (session_id, live_state_version, plan_hash),
  unique (id, session_id),
  foreign key (job_id, session_id)
    references public.session_plan_jobs(id, session_id)
    on delete cascade
);

create table if not exists public.session_plan_rounds (
  plan_version_id uuid not null,
  session_id uuid not null,
  round_no int not null check (round_no > 0),
  resting_ids uuid[] not null default '{}'::uuid[],
  matches jsonb not null check (jsonb_typeof(matches) = 'array'),
  quality_summary jsonb not null default '{}'::jsonb,
  output_hash text not null,
  created_at timestamptz not null default now(),
  primary key (plan_version_id, round_no),
  foreign key (plan_version_id, session_id)
    references public.session_plan_versions(id, session_id)
    on delete cascade
);

create index if not exists idx_session_plan_jobs_session_created
  on public.session_plan_jobs(session_id, created_at desc);

create index if not exists idx_session_plan_jobs_status_updated
  on public.session_plan_jobs(status, updated_at);

create index if not exists idx_session_plan_versions_session_created
  on public.session_plan_versions(session_id, created_at desc);

create index if not exists idx_session_plan_rounds_session_round
  on public.session_plan_rounds(session_id, round_no);

alter table public.session_plan_jobs enable row level security;
alter table public.session_plan_versions enable row level security;
alter table public.session_plan_rounds enable row level security;

do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array['session_plan_jobs', 'session_plan_versions', 'session_plan_rounds']
  loop
    v_policy := 'host_select_' || v_table;
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = v_policy
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.sessions s where s.id = %I.session_id and s.host_id = auth.uid()))',
        v_policy,
        v_table,
        v_table
      );
    end if;
  end loop;
end;
$$;

revoke all on table public.session_plan_jobs from anon, authenticated;
revoke all on table public.session_plan_versions from anon, authenticated;
revoke all on table public.session_plan_rounds from anon, authenticated;

grant select on table public.session_plan_jobs to authenticated;
grant select on table public.session_plan_versions to authenticated;
grant select on table public.session_plan_rounds to authenticated;

grant all on table public.session_plan_jobs to service_role;
grant all on table public.session_plan_versions to service_role;
grant all on table public.session_plan_rounds to service_role;
