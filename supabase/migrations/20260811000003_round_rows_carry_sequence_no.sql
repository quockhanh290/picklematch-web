-- P1-4, last site: give a completed round a session-wide anchor of its own.
--
-- computeRestFairness has to answer "has this player played in activity state.rounds does not cover
-- yet?" and had only round numbers to answer it with. round_no counts cycles on ONE court, so comparing
-- a player's against state.current_round compares two different courts' counters.
--
-- Swapping in last_played_seq was tried and is worse, in two distinct ways, both measured:
--   * against the session's newest sequence, everyone but the last court to finish reads as resting;
--   * against the newest sequence among players of tracked rounds, that anchor is read from those
--     players' CURRENT state, so the moment they play again it rises to the session maximum and the
--     extension stops firing at all.
-- Both fail because the anchor was derived from player state. A round's own sequence number cannot
-- drift like that: max(sequence_no) over the matches in the round is a fact about the round.
--
-- Definition read back from production with only the two added lines.

CREATE OR REPLACE FUNCTION public.get_live_session_snapshot_versioned(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_live_state_version bigint;
  v_player_rows jsonb;
  v_registered_player_rows jsonb;
  v_pair_rows jsonb;
  v_round_rows jsonb;
  v_synthetic_round_rows jsonb;
  v_live_match_rows jsonb;
  v_has_live_match_rows boolean := false;
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

  select exists (
    select 1
    from public.session_live_matches
    where session_id = p_session_id
      and status <> 'cancelled'
  )
  into v_has_live_match_rows;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.round_no), '[]'::jsonb)
  into v_round_rows
  from (
    select *
    from public.session_rounds
    where session_id = p_session_id
      and (
        v_has_live_match_rows = false
        or status = 'completed'
      )
    order by round_no
  ) row_data;

  select coalesce(jsonb_agg(round_row order by round_no), '[]'::jsonb)
  into v_synthetic_round_rows
  from (
    with closable_rounds as (
      select slm.round_no
      from public.session_live_matches slm
      where slm.session_id = p_session_id
        and slm.round_no is not null
        and slm.status <> 'cancelled'
        and not exists (
          select 1
          from public.session_rounds sr
          where sr.session_id = p_session_id
            and sr.round_no = slm.round_no
            and sr.status = 'completed'
        )
      group by slm.round_no
      having count(*) filter (where slm.status = 'completed') > 0
    ),
    round_agg as (
      select
        slm.round_no,
        jsonb_agg(
          jsonb_build_object(
            'court_idx', slm.court_idx,
            'team_a', slm.team_a,
            'team_b', slm.team_b
          ) order by slm.court_idx
        ) as matches,
        min(slm.id::text) as synthetic_id,
        max(slm.sequence_no) as sequence_no,
        min(slm.started_at) as started_at,
        max(slm.ended_at) as ended_at
      from public.session_live_matches slm
      join closable_rounds cr on cr.round_no = slm.round_no
      where slm.session_id = p_session_id
        and slm.status = 'completed'
      group by slm.round_no
    ),
    round_players as (
      select
        slm.round_no,
        array_agg(distinct player_id::uuid order by player_id::uuid) as playing_ids
      from public.session_live_matches slm
      join closable_rounds cr on cr.round_no = slm.round_no
      cross join lateral (select jsonb_array_elements_text(slm.team_a || slm.team_b) as player_id) players
      where slm.session_id = p_session_id
        and slm.status <> 'cancelled'
      group by slm.round_no
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
            and coalesce(sps.opted_rest, false) = false
        ),
        'sequence_no', ra.sequence_no,
        'started_at', ra.started_at,
        'ended_at', ra.ended_at
      ) as round_row,
      ra.round_no
    from round_agg ra
    join round_players rp using (round_no)
  ) derived;

  select coalesce(jsonb_agg(value order by (value ->> 'round_no')::int), '[]'::jsonb)
  into v_round_rows
  from jsonb_array_elements(v_round_rows || v_synthetic_round_rows) as merged(value);

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
$function$;
