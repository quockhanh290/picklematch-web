create or replace function public.replace_live_session_suggestions_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_matches jsonb,
  p_replace_court_idxs jsonb default '[]'::jsonb,
  p_replace_all boolean default false,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_next_version bigint;
  v_target_courts int[] := '{}';
  v_match_count int := 0;
  v_existing_norm jsonb := '[]'::jsonb;
  v_incoming_norm jsonb := '[]'::jsonb;
  v_existing_matches jsonb := '[]'::jsonb;
  v_inserted jsonb := '[]'::jsonb;
  v_base_sequence int := 0;
  v_round_no int := 0;
  v_cancelled_count int := 0;
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'Matches must be an array';
  end if;
  if p_replace_court_idxs is null or jsonb_typeof(p_replace_court_idxs) <> 'array' then
    raise exception 'Replacement courts must be an array';
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
    raise exception 'Only the host can replace live match suggestions';
  end if;
  if v_live_state_version <> p_expected_live_state_version then
    raise exception 'Session changed';
  end if;

  select count(*)::int
  into v_match_count
  from jsonb_array_elements(p_matches) as match(value);

  if exists (
    select 1
    from jsonb_array_elements(p_matches) as match(value)
    where jsonb_array_length(coalesce(match.value -> 'team_a', '[]'::jsonb)) <> 2
       or jsonb_array_length(coalesce(match.value -> 'team_b', '[]'::jsonb)) <> 2
       or coalesce(match.value ->> 'court_idx', '') !~ '^-?[0-9]+$'
  ) then
    raise exception 'Each suggested match must have court_idx, two team_a players, and two team_b players';
  end if;

  if exists (
    select 1
    from (
      select (match.value ->> 'court_idx')::int as court_idx, count(*)::int as n
      from jsonb_array_elements(p_matches) as match(value)
      group by 1
    ) courts
    where courts.n > 1
  ) then
    raise exception 'Only one suggested match is allowed per court';
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
    from match_players
    group by player_id
    having count(*) > 1
  ) then
    raise exception 'A player cannot appear in more than one suggested match';
  end if;

  select coalesce(array_agg(distinct court_idx order by court_idx), '{}')
  into v_target_courts
  from (
    select (value #>> '{}')::int as court_idx
    from jsonb_array_elements(p_replace_court_idxs) as requested(value)
    where (value #>> '{}') ~ '^-?[0-9]+$'
    union
    select (match.value ->> 'court_idx')::int as court_idx
    from jsonb_array_elements(p_matches) as match(value)
    where coalesce(match.value ->> 'court_idx', '') ~ '^-?[0-9]+$'
    union
    select court_idx
    from public.session_live_matches
    where p_replace_all
      and session_id = p_session_id
      and status = 'suggested'
      and court_idx is not null
  ) targets
  where court_idx is not null and court_idx >= 0;

  if v_match_count = 0 and coalesce(array_length(v_target_courts, 1), 0) = 0 then
    return jsonb_build_object(
      'live_state_version', v_live_state_version,
      'matches', '[]'::jsonb,
      'persisted_preview_noop', true
    );
  end if;

  select coalesce(
    (
      select min(round_no)
      from public.session_live_matches
      where session_id = p_session_id
        and (
          status = 'live'
          or (
            status = 'suggested'
            and (
              p_replace_all = false
              and (
                court_idx is null
                or not (court_idx = any(v_target_courts))
              )
            )
          )
        )
    ),
    coalesce(
      (select max(round_no) + 1 from public.session_live_matches where session_id = p_session_id),
      0
    )
  )
  into v_round_no;

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
     and (
       slm.team_a ? mp.player_id::text
       or slm.team_b ? mp.player_id::text
     )
    where slm.status = 'live'
       or (
         slm.status = 'suggested'
         and p_replace_all = false
         and (
           slm.court_idx is null
           or not (slm.court_idx = any(v_target_courts))
         )
       )
       or (
         slm.round_no = v_round_no
         and slm.status not in ('cancelled', 'suggested')
       )
  ) then
    raise exception 'A suggested player is already assigned or already played in this round';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'court_idx', item ->> 'team_a', item ->> 'team_b'), '[]'::jsonb)
  into v_incoming_norm
  from (
    select jsonb_build_object(
      'court_idx', (match.value ->> 'court_idx')::int,
      'team_a', match.value -> 'team_a',
      'team_b', match.value -> 'team_b',
      'resting', coalesce(match.value -> 'resting', '[]'::jsonb)
    ) as item
    from jsonb_array_elements(p_matches) as match(value)
  ) incoming;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'court_idx', slm.court_idx,
      'team_a', slm.team_a,
      'team_b', slm.team_b,
      'resting', coalesce(slm.resting, '[]'::jsonb)
    ) order by slm.court_idx, slm.team_a::text, slm.team_b::text), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(slm) order by slm.court_idx, slm.sequence_no), '[]'::jsonb)
  into v_existing_norm, v_existing_matches
  from public.session_live_matches slm
  where slm.session_id = p_session_id
    and slm.status = 'suggested'
    and (
      p_replace_all
      or slm.court_idx = any(v_target_courts)
    );

  if v_existing_norm = v_incoming_norm then
    return jsonb_build_object(
      'live_state_version', v_live_state_version,
      'matches', v_existing_matches,
      'persisted_preview_noop', true
    );
  end if;

  update public.session_live_matches
  set status = 'cancelled',
      ended_at = coalesce(ended_at, now())
  where session_id = p_session_id
    and status = 'suggested'
    and (
      p_replace_all
      or court_idx = any(v_target_courts)
    );

  get diagnostics v_cancelled_count = row_count;

  select coalesce(max(sequence_no) + 1, 0)
  into v_base_sequence
  from public.session_live_matches
  where session_id = p_session_id;

  with inserted as (
    insert into public.session_live_matches (
      session_id,
      sequence_no,
      round_no,
      court_idx,
      status,
      team_a,
      team_b,
      resting
    )
    select
      p_session_id,
      v_base_sequence + ordinality::int - 1,
      v_round_no,
      (match.value ->> 'court_idx')::int,
      'suggested',
      match.value -> 'team_a',
      match.value -> 'team_b',
      coalesce(match.value -> 'resting', '[]'::jsonb)
    from jsonb_array_elements(p_matches) with ordinality as match(value, ordinality)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.court_idx, inserted.sequence_no), '[]'::jsonb)
  into v_inserted
  from inserted;

  if v_match_count > 0 or v_cancelled_count > 0 then
    update public.sessions
    set live_state_version = live_state_version + 1
    where id = p_session_id
    returning live_state_version into v_next_version;
  else
    v_next_version := v_live_state_version;
  end if;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    v_round_no,
    'live_match_suggestions_replaced',
    coalesce(p_audit_payload, '{}'::jsonb)
      || jsonb_build_object(
        'matches', v_inserted,
        'replace_court_idxs', to_jsonb(v_target_courts),
        'replace_all', p_replace_all,
        'cancelled_count', v_cancelled_count
      )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'matches', v_inserted,
    'persisted_preview_noop', false
  );
end;
$$;

revoke all on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.replace_live_session_suggestions_versioned(uuid, bigint, jsonb, jsonb, boolean, jsonb) to authenticated;

create or replace function public.start_live_session_match_versioned(
  p_session_id uuid,
  p_expected_live_state_version bigint,
  p_match_id uuid,
  p_audit_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    left join public.session_player_state sps
      on sps.session_id = p_session_id and sps.player_id = p.player_id
    where sps.player_id is null
      or sps.checked_out_at is not null
      or sps.opted_rest
  ) then
    raise exception 'Live match must use available checked-in players';
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
     and live.id <> p_match_id
     and (live.team_a ? p.player_id::text or live.team_b ? p.player_id::text)
    where live.status = 'live'
       or (
         live.round_no = v_match.round_no
         and live.status not in ('cancelled', 'suggested')
       )
  ) then
    raise exception 'A player is already in a live match or already played in this round';
  end if;

  if v_match.court_idx is not null and exists (
    select 1
    from public.session_live_matches live
    where live.session_id = p_session_id
      and live.id <> p_match_id
      and live.status = 'live'
      and live.court_idx = v_match.court_idx
  ) then
    raise exception 'Court already has a live match';
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
    v_match.round_no,
    'live_match_started',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('match', to_jsonb(v_match))
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'match', to_jsonb(v_match)
  );
end;
$$;

revoke all on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_live_session_match_versioned(uuid, bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
