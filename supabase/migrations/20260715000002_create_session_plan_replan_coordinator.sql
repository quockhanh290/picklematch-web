create table if not exists public.session_plan_replan_state (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  requested_by uuid not null,
  frontier_fingerprint text not null,
  generation bigint not null default 1,
  status text not null default 'pending'
    check (status in ('idle', 'pending', 'running', 'backoff')),
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_session_plan_replan_ready
  on public.session_plan_replan_state(status, next_attempt_at);

alter table public.session_plan_replan_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'session_plan_replan_state'
      and policyname = 'host_select_session_plan_replan_state'
  ) then
    create policy "host_select_session_plan_replan_state"
      on public.session_plan_replan_state for select
      to authenticated
      using (exists (
        select 1 from public.sessions s
        where s.id = session_plan_replan_state.session_id
          and s.host_id = auth.uid()
      ));
  end if;
end;
$$;

revoke all on table public.session_plan_replan_state from anon, authenticated;
grant select on table public.session_plan_replan_state to authenticated;
grant all on table public.session_plan_replan_state to service_role;

create or replace function public.request_session_plan_replan(
  p_session_id uuid,
  p_requested_by uuid,
  p_frontier_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.session_plan_replan_state;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_frontier_fingerprint is null or length(trim(p_frontier_fingerprint)) = 0 then
    raise exception 'frontier fingerprint required';
  end if;

  insert into public.session_plan_replan_state (
    session_id, requested_by, frontier_fingerprint
  ) values (
    p_session_id, p_requested_by, p_frontier_fingerprint
  )
  on conflict (session_id) do update set
    requested_by = excluded.requested_by,
    generation = case
      when session_plan_replan_state.frontier_fingerprint is distinct from excluded.frontier_fingerprint
        then session_plan_replan_state.generation + 1
      else session_plan_replan_state.generation
    end,
    frontier_fingerprint = excluded.frontier_fingerprint,
    status = case
      when session_plan_replan_state.frontier_fingerprint = excluded.frontier_fingerprint
        and session_plan_replan_state.status in ('pending', 'running', 'backoff')
        then session_plan_replan_state.status
      else 'pending'
    end,
    attempt_count = case
      when session_plan_replan_state.frontier_fingerprint = excluded.frontier_fingerprint
        then session_plan_replan_state.attempt_count
      else 0
    end,
    next_attempt_at = case
      when session_plan_replan_state.frontier_fingerprint = excluded.frontier_fingerprint
        and session_plan_replan_state.status in ('pending', 'running', 'backoff')
        then session_plan_replan_state.next_attempt_at
      else now()
    end,
    requested_at = case
      when session_plan_replan_state.frontier_fingerprint = excluded.frontier_fingerprint
        and session_plan_replan_state.status in ('pending', 'running', 'backoff')
        then session_plan_replan_state.requested_at
      else now()
    end,
    completed_at = null,
    last_error = case
      when session_plan_replan_state.frontier_fingerprint = excluded.frontier_fingerprint
        then session_plan_replan_state.last_error
      else null
    end,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'session_id', v_row.session_id,
    'generation', v_row.generation,
    'status', v_row.status,
    'next_attempt_at', v_row.next_attempt_at
  );
end;
$$;

create or replace function public.claim_session_plan_replan(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.session_plan_replan_state;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  update public.session_plan_replan_state
  set status = 'running',
      claimed_at = now(),
      updated_at = now()
  where session_id = p_session_id
    and (
      (status in ('pending', 'backoff') and next_attempt_at <= now())
      or (status = 'running' and claimed_at < now() - interval '2 minutes')
    )
  returning * into v_row;

  if v_row.session_id is null then return null; end if;
  return jsonb_build_object(
    'session_id', v_row.session_id,
    'generation', v_row.generation,
    'frontier_fingerprint', v_row.frontier_fingerprint,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

create or replace function public.finish_session_plan_replan(
  p_session_id uuid,
  p_generation bigint,
  p_result text,
  p_error jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.session_plan_replan_state;
  v_attempt int;
  v_delay_seconds int;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_result not in ('completed', 'resume', 'deferred', 'failed') then
    raise exception 'invalid replan result';
  end if;

  select * into v_row
  from public.session_plan_replan_state
  where session_id = p_session_id
  for update;

  if v_row.session_id is null then return jsonb_build_object('updated', false, 'reason', 'missing'); end if;
  if v_row.generation <> p_generation then
    return jsonb_build_object('updated', false, 'reason', 'superseded', 'generation', v_row.generation);
  end if;

  v_attempt := case when p_result = 'failed' then v_row.attempt_count + 1 else 0 end;
  v_delay_seconds := least(60, 5 * (2 ^ least(v_attempt, 4))::int);

  update public.session_plan_replan_state set
    status = case
      when p_result in ('completed', 'deferred') then 'idle'
      when p_result = 'resume' then 'pending'
      else 'backoff'
    end,
    attempt_count = v_attempt,
    next_attempt_at = case
      when p_result = 'resume' then now() + interval '1 second'
      when p_result = 'failed' then now() + make_interval(secs => v_delay_seconds)
      else now()
    end,
    completed_at = case when p_result in ('completed', 'deferred') then now() else null end,
    claimed_at = null,
    last_error = p_error,
    updated_at = now()
  where session_id = p_session_id
  returning * into v_row;

  return jsonb_build_object(
    'updated', true,
    'generation', v_row.generation,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'next_attempt_at', v_row.next_attempt_at
  );
end;
$$;

revoke all on function public.request_session_plan_replan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_session_plan_replan(uuid) from public, anon, authenticated;
revoke all on function public.finish_session_plan_replan(uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.request_session_plan_replan(uuid, uuid, text) to service_role;
grant execute on function public.claim_session_plan_replan(uuid) to service_role;
grant execute on function public.finish_session_plan_replan(uuid, bigint, text, jsonb) to service_role;
