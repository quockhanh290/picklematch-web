WITH round_playing AS (
  SELECT
    round_no,
    array_agg(DISTINCT player_id::uuid ORDER BY player_id::uuid) AS playing_ids,
    jsonb_agg(
      jsonb_build_object('court_idx', court_idx, 'team_a', team_a, 'team_b', team_b)
      ORDER BY court_idx
    ) AS matches,
    COUNT(DISTINCT player_id) AS player_count
  FROM public.session_live_matches,
    LATERAL (SELECT jsonb_array_elements_text(team_a || team_b) AS player_id) players
  WHERE session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
    AND status = 'completed'
  GROUP BY round_no
)
SELECT round_no, player_count, array_length(playing_ids, 1) as n_players
FROM round_playing
ORDER BY round_no;
