alter table public.session_plan_jobs
  add column if not exists result_plan_version_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_plan_jobs_result_plan_version_id_fkey'
      and conrelid = 'public.session_plan_jobs'::regclass
  ) then
    alter table public.session_plan_jobs
      add constraint session_plan_jobs_result_plan_version_id_fkey
      foreign key (result_plan_version_id)
      references public.session_plan_versions(id)
      on delete set null;
  end if;
end;
$$;
