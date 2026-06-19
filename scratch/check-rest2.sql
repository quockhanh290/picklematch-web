-- Xem ai đang nghỉ theo từng round (synthetic derivation)
WITH
round_agg AS (
  SELECT
    round_no,
    jsonb_agg(
      jsonb_build_object('court_idx', court_idx, 'team_a', team_a, 'team_b', team_b)
      ORDER BY court_idx
    ) AS matches,
    min(started_at) AS started_at
  FROM public.session_live_matches
  WHERE session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
    AND status = 'completed'
  GROUP BY round_no
),
round_players AS (
  SELECT
    round_no,
    array_agg(DISTINCT player_id::uuid ORDER BY player_id::uuid) AS playing_ids
  FROM public.session_live_matches,
    LATERAL (SELECT jsonb_array_elements_text(team_a || team_b) AS player_id) players
  WHERE session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
    AND status = 'completed'
  GROUP BY round_no
),
resting_per_round AS (
  SELECT
    ra.round_no,
    sps.player_id,
    sps.checked_in_at
  FROM round_agg ra
  JOIN round_players rp USING (round_no),
    LATERAL (
      SELECT player_id, checked_in_at
      FROM public.session_player_state sps
      WHERE sps.session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
        AND sps.checked_out_at IS NULL
        AND NOT (sps.player_id = ANY(rp.playing_ids))
    ) sps
)
-- Players nghỉ >= 2 rounds liên tiếp
SELECT
  player_id,
  array_agg(round_no ORDER BY round_no) AS rested_rounds,
  count(*) AS rest_count
FROM resting_per_round
GROUP BY player_id
HAVING count(*) >= 2
ORDER BY rest_count DESC, player_id;
