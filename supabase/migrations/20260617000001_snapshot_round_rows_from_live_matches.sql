-- Derive round_rows from completed session_live_matches when session_rounds is empty.
-- Sessions using the live-match-only flow never write to session_rounds, so the snapshot
-- returned round_rows: [] — leaving the algorithm with no group-rematch history, causing
-- exact repeat suggestions (e.g. same 4 players from the previous round).

create or replace function public.get_live_session_snapshot_versioned(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_player_rows jsonb;
  v_registered_player_rows jsonb;
  v_pair_rows jsonb;
  v_round_rows jsonb;
  v_live_match_rows jsonb;
begin
  select host_id, live_state_version
  into v_host_id, v_live_state_version
  from public.sessions
  where id = p_session_id
  for share;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can load live session snapshot';
  end if;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.checked_in_at), '[]'::jsonb)
  into v_player_rows
  from (
    select
      sps.*,
      jsonb_build_object(
        'name', p.name,
        'pvna', p.pvna,
        'current_elo', p.current_elo,
        'elo', p.elo,
        'gender', p.gender,
        'partner_gender_pref', p.partner_gender_pref,
        'opponent_gender_pref', p.opponent_gender_pref
      ) as players,
      jsonb_build_object(
        'status', sp.status,
        'check_in_status', sp.check_in_status,
        'metadata', sp.metadata
      ) as session_players
    from public.session_player_state sps
    left join public.players p on p.id = sps.player_id
    left join public.session_players sp
      on sp.session_id = sps.session_id
      and sp.player_id = sps.player_id
    where sps.session_id = p_session_id
    order by sps.checked_in_at
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at, row_data.player_id), '[]'::jsonb)
  into v_registered_player_rows
  from (
    select
      sp.player_id,
      sp.team_no,
      sp.status,
      sp.check_in_status,
      sp.metadata,
      sp.created_at,
      jsonb_build_object(
        'name', p.name,
        'pvna', p.pvna,
        'current_elo', p.current_elo,
        'elo', p.elo,
        'gender', p.gender,
        'reliability_score', p.reliability_score,
        'sessions_joined', p.sessions_joined,
        'no_show_count', p.no_show_count,
        'self_assessed_level', p.self_assessed_level,
        'skill_label', p.skill_label,
        'partner_gender_pref', p.partner_gender_pref,
        'opponent_gender_pref', p.opponent_gender_pref
      ) as players
    from public.session_players sp
    left join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
    order by sp.created_at, sp.player_id
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.player_a, row_data.player_b), '[]'::jsonb)
  into v_pair_rows
  from (
    select *
    from public.session_pair_history
    where session_id = p_session_id
    order by player_a, player_b
  ) row_data;

  -- Primary: session_rounds table (legacy flow that writes explicit rounds).
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.round_no), '[]'::jsonb)
  into v_round_rows
  from (
    select *
    from public.session_rounds
    where session_id = p_session_id
    order by round_no
  ) row_data;

  -- Fallback: derive synthetic round_rows from completed session_live_matches.
  -- Used by sessions that track history only via live matches (no session_rounds rows).
  -- Groups courts by round_no, aggregates matches, computes resting as active players
  -- not present in any court of that round.
  if v_round_rows = '[]'::jsonb then
    select coalesce(jsonb_agg(round_row order by round_no), '[]'::jsonb)
    into v_round_rows
    from (
      -- round_agg: one row per round — aggregates matches without player expansion
      with round_agg as (
        select
          round_no,
          jsonb_agg(
            jsonb_build_object(
              'court_idx', court_idx,
              'team_a', team_a,
              'team_b', team_b
            ) order by court_idx
          ) as matches,
          min(id::text) as synthetic_id,
          min(started_at) as started_at,
          max(ended_at) as ended_at
        from public.session_live_matches
        where session_id = p_session_id
          and status = 'completed'
        group by round_no
      ),
      -- round_players: expand each match into 4 player rows, collect distinct player set per round
      round_players as (
        select
          round_no,
          array_agg(distinct player_id::uuid order by player_id::uuid) as playing_ids
        from public.session_live_matches,
          lateral (select jsonb_array_elements_text(team_a || team_b) as player_id) players
        where session_id = p_session_id
          and status = 'completed'
        group by round_no
      )
      select
        jsonb_build_object(
          'id', ra.synthetic_id,
          'session_id', p_session_id,
          'round_no', ra.round_no,
          'status', 'completed',
          'matches', ra.matches,
          'resting', (
            select coalesce(jsonb_agg(sps.player_id order by sps.player_id), '[]'::jsonb)
            from public.session_player_state sps
            where sps.session_id = p_session_id
              and sps.checked_out_at is null
              and sps.checked_in_at <= ra.started_at
              and not (sps.player_id = any(rp.playing_ids))
          ),
          'started_at', ra.started_at,
          'ended_at', ra.ended_at
        ) as round_row,
        ra.round_no
      from round_agg ra
      join round_players rp using (round_no)
    ) derived;
  end if;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sequence_no), '[]'::jsonb)
  into v_live_match_rows
  from (
    select *
    from public.session_live_matches
    where session_id = p_session_id
    order by sequence_no
  ) row_data;

  return jsonb_build_object(
    'live_state_version', v_live_state_version,
    'player_rows', v_player_rows,
    'registered_player_rows', v_registered_player_rows,
    'pair_rows', v_pair_rows,
    'round_rows', v_round_rows,
    'live_match_rows', v_live_match_rows
  );
end;
$$;

revoke all on function public.get_live_session_snapshot_versioned(uuid) from public, anon, authenticated;
grant execute on function public.get_live_session_snapshot_versioned(uuid) to authenticated;

notify pgrst, 'reload schema';
