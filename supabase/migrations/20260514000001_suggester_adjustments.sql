create table if not exists public.suggester_adjustments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  triggered_by_warnings text[] not null,
  config_changes jsonb,
  tier_overrides jsonb,
  fairness_score_before int,
  fairness_score_after int,
  created_at timestamptz not null default now()
);

comment on column public.suggester_adjustments.fairness_score_after is
  'Nullable until the started round is committed; Phase B should ignore null outcomes.';

create index if not exists idx_adjustments_session
  on public.suggester_adjustments(session_id, round_no);

alter table public.suggester_adjustments enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggester_adjustments'
      and policyname = 'Hosts can read suggester adjustments'
  ) then
    create policy "Hosts can read suggester adjustments"
      on public.suggester_adjustments
      for select
      using (
        exists (
          select 1
          from public.sessions s
          where s.id = suggester_adjustments.session_id
            and s.host_id = auth.uid()
        )
      );
  end if;
end $$;
