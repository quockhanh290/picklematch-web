-- Next-match suggester: store and mutate live matches as the primary unit.

create table if not exists public.session_live_matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  sequence_no int not null,
  court_idx int,
  status text not null check (status in ('suggested', 'live', 'completed', 'cancelled')),
  team_a jsonb not null,
  team_b jsonb not null,
  resting jsonb not null default '[]'::jsonb,
  score_a int not null default 0 check (score_a >= 0),
  score_b int not null default 0 check (score_b >= 0),
  suggested_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, sequence_no),
  check (sequence_no >= 0),
  check (court_idx is null or court_idx >= 0),
  check (jsonb_typeof(team_a) = 'array' and jsonb_array_length(team_a) = 2),
  check (jsonb_typeof(team_b) = 'array' and jsonb_array_length(team_b) = 2),
  check (jsonb_typeof(resting) = 'array'),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists idx_session_live_matches_session_status
on public.session_live_matches(session_id, status);

drop trigger if exists tr_session_live_matches_updated_at on public.session_live_matches;
create trigger tr_session_live_matches_updated_at
before update on public.session_live_matches
for each row execute function public.touch_next_round_updated_at();

alter table public.session_live_matches enable row level security;

drop policy if exists "session live matches visible to participants" on public.session_live_matches;
create policy "session live matches visible to participants"
on public.session_live_matches for select
using (
  exists (
    select 1
    from public.sessions s
    left join public.session_players sp
      on sp.session_id = s.id and sp.player_id = auth.uid()
    where s.id = session_live_matches.session_id
      and (s.host_id = auth.uid() or sp.player_id is not null)
  )
);

drop policy if exists "session live matches host writes" on public.session_live_matches;
create policy "session live matches host writes"
on public.session_live_matches for all
using (
  exists (
    select 1 from public.sessions s
    where s.id = session_live_matches.session_id
      and s.host_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.sessions s
    where s.id = session_live_matches.session_id
      and s.host_id = auth.uid()
  )
);

create or replace function public.create_live_session_matches_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_matches jsonb,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_base_sequence int;
  v_inserted jsonb := '[]'::jsonb;
  v_next_version bigint;
begin
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'Matches must be an array';
  end if;

  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can create live matches';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
    )
    select 1
    from match_players mp
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = mp.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Suggested matches must use available checked-in players';
  end if;

  if exists (
    with match_players as (
      select jsonb_array_elements_text(match.value -> 'team_a')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
      union all
      select jsonb_array_elements_text(match.value -> 'team_b')::uuid as player_id
      from jsonb_array_elements(p_matches) as match(value)
    )
    select 1
    from match_players mp
    join public.session_live_matches slm
      on slm.session_id = p_session_id
     and slm.status in ('suggested', 'live')
     and (
       slm.team_a ? mp.player_id::text
       or slm.team_b ? mp.player_id::text
     )
  ) then
    raise exception 'A suggested player is already assigned to a live/suggested match';
  end if;

  select coalesce(max(sequence_no) + 1, 0)
  into v_base_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  with inserted as (
    insert into public.session_live_matches (
      session_id,
      sequence_no,
      court_idx,
      status,
      team_a,
      team_b,
      resting
    )
    select
      p_session_id,
      v_base_sequence + ordinality::int - 1,
      nullif((match.value ->> 'court_idx')::int, -1),
      'suggested',
      match.value -> 'team_a',
      match.value -> 'team_b',
      coalesce(match.value -> 'resting', '[]'::jsonb)
    from jsonb_array_elements(p_matches) with ordinality as match(value, ordinality)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.sequence_no), '[]'::jsonb)
  into v_inserted
  from inserted;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_base_sequence,
    'live_matches_suggested',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('matches', v_inserted)
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'matches', v_inserted
  );
end;
$$;

create or replace function public.start_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_match public.session_live_matches;
  v_next_version bigint;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can start live match';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status <> 'suggested' then
    raise exception 'Only suggested matches can be started';
  end if;

  if exists (
    with players as (
      select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
      union all
      select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
    )
    select 1
    from players p
    join public.session_live_matches live
      on live.session_id = p_session_id
     and live.status = 'live'
     and live.id <> p_match_id
     and (live.team_a ? p.player_id::text or live.team_b ? p.player_id::text)
  ) then
    raise exception 'A player is already in a live match';
  end if;

  update public.session_live_matches
  set status = 'live',
      started_at = coalesce(started_at, now())
  where id = p_match_id
  returning * into v_match;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_started',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$$;

create or replace function public.complete_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_score_after int,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_match public.session_live_matches;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
  v_changed_pair_history jsonb := '[]'::jsonb;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can complete live match';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select *
  into v_match
  from public.session_live_matches
  where id = p_match_id
    and session_id = p_session_id
  for update;

  if v_match.id is null then
    raise exception 'Live match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'Only live matches can be completed';
  end if;

  update public.session_live_matches
  set status = 'completed',
      score_a = greatest(0, p_score_a),
      score_b = greatest(0, p_score_b),
      ended_at = now()
  where id = p_match_id
  returning * into v_match;

  with played as (
    select jsonb_array_elements_text(v_match.team_a)::uuid as player_id
    union
    select jsonb_array_elements_text(v_match.team_b)::uuid as player_id
  ),
  resting as (
    select jsonb_array_elements_text(v_match.resting)::uuid as player_id
  ),
  updated_played as (
    update public.session_player_state sps
    set matches_played = sps.matches_played + 1,
        last_played_round = v_match.sequence_no,
        consecutive_play = sps.consecutive_play + 1,
        consecutive_rest = 0,
        opted_rest = false
    from played
    where sps.session_id = p_session_id
      and sps.player_id = played.player_id
    returning sps.*
  ),
  updated_resting as (
    update public.session_player_state sps
    set consecutive_rest = sps.consecutive_rest + 1,
        consecutive_play = 0
    from resting
    where sps.session_id = p_session_id
      and sps.player_id = resting.player_id
      and sps.checked_out_at is null
      and not sps.opted_rest
      and not exists (select 1 from played where played.player_id = sps.player_id)
    returning sps.*
  ),
  changed as (
    select * from updated_played
    union all
    select * from updated_resting
  )
  select coalesce(jsonb_agg(to_jsonb(changed) order by changed.player_id), '[]'::jsonb)
  into v_changed_player_state
  from changed;

  with match_teams as (
    select
      array(select jsonb_array_elements_text(v_match.team_a)::uuid) as team_a,
      array(select jsonb_array_elements_text(v_match.team_b)::uuid) as team_b
  ),
  partner_pairs as (
    select least(team_a[1], team_a[2]) as player_a, greatest(team_a[1], team_a[2]) as player_b
    from match_teams
    union all
    select least(team_b[1], team_b[2]) as player_a, greatest(team_b[1], team_b[2]) as player_b
    from match_teams
  ),
  opponent_pairs as (
    select least(a.player_id, b.player_id) as player_a, greatest(a.player_id, b.player_id) as player_b
    from match_teams
    cross join lateral unnest(team_a) as a(player_id)
    cross join lateral unnest(team_b) as b(player_id)
  ),
  pair_deltas as (
    select player_a, player_b, count(*)::int as partner_delta, 0::int as opponent_delta
    from partner_pairs
    group by player_a, player_b
    union all
    select player_a, player_b, 0::int as partner_delta, count(*)::int as opponent_delta
    from opponent_pairs
    group by player_a, player_b
  ),
  merged_deltas as (
    select player_a, player_b, sum(partner_delta)::int as partner_delta, sum(opponent_delta)::int as opponent_delta
    from pair_deltas
    group by player_a, player_b
  ),
  upserted as (
    insert into public.session_pair_history(session_id, player_a, player_b, partner_count, opponent_count)
    select p_session_id, player_a, player_b, partner_delta, opponent_delta
    from merged_deltas
    on conflict (session_id, player_a, player_b)
    do update set
      partner_count = public.session_pair_history.partner_count + excluded.partner_count,
      opponent_count = public.session_pair_history.opponent_count + excluded.opponent_count
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(upserted) order by upserted.player_a, upserted.player_b), '[]'::jsonb)
  into v_changed_pair_history
  from upserted;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_match.sequence_no,
    'live_match_completed',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object(
      'match', to_jsonb(v_match),
      'score_after', p_score_after
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match),
    'changed_player_state', v_changed_player_state,
    'changed_pair_history', v_changed_pair_history
  );
end;
$$;

revoke all on function public.create_live_session_matches_versioned(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) from public, anon, authenticated;

grant execute on function public.create_live_session_matches_versioned(uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;
grant execute on function public.complete_live_session_match_versioned(uuid, bigint, uuid, int, int, int, jsonb) to authenticated;
