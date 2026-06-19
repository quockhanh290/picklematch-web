WITH
round_agg AS (
  SELECT
    round_no,
    jsonb_agg(
      jsonb_build_object('court_idx', court_idx, 'team_a', team_a, 'team_b', team_b)
      ORDER BY court_idx
    ) AS matches,
    min(id::text) AS synthetic_id,
    min(started_at) AS started_at,
    max(ended_at) AS ended_at
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
)
SELECT
  ra.round_no,
  jsonb_array_length(ra.matches) AS match_count,
  array_length(rp.playing_ids, 1) AS player_count
FROM round_agg ra
JOIN round_players rp USING (round_no)
ORDER BY ra.round_no;
