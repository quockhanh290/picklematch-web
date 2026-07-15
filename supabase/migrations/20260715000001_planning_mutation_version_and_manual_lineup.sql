alter table public.sessions
  add column if not exists planning_mutation_version bigint not null default 0;

alter table public.session_plan_jobs
  add column if not exists planning_mutation_version bigint not null default 0;

create or replace function public.bump_planning_mutation_version(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_version bigint;
begin
  update public.sessions
  set planning_mutation_version = planning_mutation_version + 1
  where id = p_session_id
  returning planning_mutation_version into v_next_version;

  if v_next_version is null then
    raise exception 'Session not found';
  end if;
  return v_next_version;
end;
$$;

revoke all on function public.bump_planning_mutation_version(uuid) from public, anon, authenticated;
grant execute on function public.bump_planning_mutation_version(uuid) to service_role;

create or replace function public.bump_planning_version_from_player_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.bump_planning_mutation_version(new.session_id);
  elsif tg_op = 'DELETE' then
    perform public.bump_planning_mutation_version(old.session_id);
  elsif old.checked_in_at is distinct from new.checked_in_at
     or old.checked_out_at is distinct from new.checked_out_at
     or old.opted_rest is distinct from new.opted_rest
     or old.effective_pvna is distinct from new.effective_pvna
     or old.group_id is distinct from new.group_id then
    perform public.bump_planning_mutation_version(new.session_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_planning_version_from_player_state() from public, anon, authenticated;

drop trigger if exists tr_session_player_state_planning_mutation on public.session_player_state;
create trigger tr_session_player_state_planning_mutation
after insert or delete or update on public.session_player_state
for each row execute function public.bump_planning_version_from_player_state();

create or replace function public.bump_planning_version_from_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.bump_planning_mutation_version(new.session_id);
  elsif tg_op = 'DELETE' then
    perform public.bump_planning_mutation_version(old.session_id);
  elsif old.court_count_override is distinct from new.court_count_override
     or old.court_preset is distinct from new.court_preset
     or old.court_duration_min is distinct from new.court_duration_min
     or old.pvna_tolerance is distinct from new.pvna_tolerance
     or old.target_rounds is distinct from new.target_rounds then
    perform public.bump_planning_mutation_version(new.session_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_planning_version_from_settings() from public, anon, authenticated;

drop trigger if exists tr_session_next_round_settings_planning_mutation on public.session_next_round_settings;
create trigger tr_session_next_round_settings_planning_mutation
after insert or delete or update on public.session_next_round_settings
for each row execute function public.bump_planning_version_from_settings();

create or replace function public.bump_planning_version_from_avoid_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.bump_planning_mutation_version(new.session_id);
  elsif tg_op = 'DELETE' then
    perform public.bump_planning_mutation_version(old.session_id);
  elsif old.player_a is distinct from new.player_a
     or old.player_b is distinct from new.player_b
     or old.reason is distinct from new.reason then
    perform public.bump_planning_mutation_version(new.session_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_planning_version_from_avoid_pair() from public, anon, authenticated;

drop trigger if exists tr_session_avoid_pairs_planning_mutation on public.session_avoid_pairs;
create trigger tr_session_avoid_pairs_planning_mutation
after insert or delete or update on public.session_avoid_pairs
for each row execute function public.bump_planning_version_from_avoid_pair();

create or replace function public.replace_manual_live_session_suggestion_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court_idx int;
  v_existing public.session_live_matches;
  v_existing_players text[] := '{}';
  v_incoming_players text[] := '{}';
  v_mutation_kind text;
  v_manual_match jsonb;
  v_result jsonb;
  v_planning_mutation_version bigint;
begin
  if p_match is null or jsonb_typeof(p_match) <> 'object' then
    raise exception 'Manual match must be an object';
  end if;
  if coalesce(p_match ->> 'court_idx', '') !~ '^[0-9]+$' then
    raise exception 'Manual match must have a non-negative court_idx';
  end if;
  v_court_idx := (p_match ->> 'court_idx')::int;

  select * into v_existing
  from public.session_live_matches
  where session_id = p_session_id
    and status = 'suggested'
    and court_idx = v_court_idx
  order by sequence_no desc
  limit 1;

  if v_existing.id is not null then
    select coalesce(array_agg(player_id order by player_id), '{}')
    into v_existing_players
    from (
      select jsonb_array_elements_text(v_existing.team_a) as player_id
      union all
      select jsonb_array_elements_text(v_existing.team_b) as player_id
    ) players;
  end if;

  select coalesce(array_agg(player_id order by player_id), '{}')
  into v_incoming_players
  from (
    select jsonb_array_elements_text(coalesce(p_match -> 'team_a', '[]'::jsonb)) as player_id
    union all
    select jsonb_array_elements_text(coalesce(p_match -> 'team_b', '[]'::jsonb)) as player_id
  ) players;

  v_mutation_kind := case
    when v_existing.id is null then 'manual_lineup_created'
    when v_existing_players = v_incoming_players then 'manual_team_repartition'
    else 'manual_player_replacement'
  end;
  v_manual_match := p_match || jsonb_build_object(
    'manual_override', true,
    'manual_mutation_kind', v_mutation_kind
  );

  v_result := public.replace_live_session_suggestions_versioned(
    p_session_id,
    p_expected_live_state_version,
    jsonb_build_array(v_manual_match),
    jsonb_build_array(v_court_idx),
    false,
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'source', 'server-manual-lineup-persist',
      'manual_mutation_kind', v_mutation_kind
    )
  );

  if coalesce((v_result ->> 'persisted_preview_noop')::boolean, false) then
    select planning_mutation_version into v_planning_mutation_version
    from public.sessions where id = p_session_id;
  else
    v_planning_mutation_version := public.bump_planning_mutation_version(p_session_id);
    insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
    values (
      p_session_id,
      coalesce((p_match ->> 'round_no')::int, 0),
      'manual_live_lineup_changed',
      jsonb_build_object(
        'court_idx', v_court_idx,
        'mutation_kind', v_mutation_kind,
        'previous_match_id', v_existing.id,
        'previous_team_a', v_existing.team_a,
        'previous_team_b', v_existing.team_b,
        'next_team_a', p_match -> 'team_a',
        'next_team_b', p_match -> 'team_b',
        'planning_mutation_version', v_planning_mutation_version
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'planning_mutation_version', v_planning_mutation_version,
    'manual_mutation_kind', case
      when coalesce((v_result ->> 'persisted_preview_noop')::boolean, false) then null
      else v_mutation_kind
    end
  );
end;
$$;

revoke all on function public.replace_manual_live_session_suggestion_versioned(uuid, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_manual_live_session_suggestion_versioned(uuid, bigint, jsonb, jsonb)
  to authenticated;
grant execute on function public.replace_manual_live_session_suggestion_versioned(uuid, bigint, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
