WITH round_playing AS (
  SELECT
    round_no,
    array_agg(DISTINCT player_id::uuid ORDER BY player_id::uuid) AS playing_ids,
    jsonb_agg(
      jsonb_build_object('court_idx', court_idx, 'team_a', team_a, 'team_b', team_b)
      ORDER BY court_idx
    ) AS matches,
    min(id::text) AS synthetic_id,
    min(started_at) AS started_at,
    max(ended_at) AS ended_at
  FROM public.session_live_matches,
    LATERAL (SELECT jsonb_array_elements_text(team_a || team_b) AS player_id) players
  WHERE session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
    AND status = 'completed'
  GROUP BY round_no
)
SELECT
  jsonb_build_object(
    'id', rp.synthetic_id,
    'session_id', 'c730fbb2-ca74-401f-938c-78b75f2ab4e9',
    'round_no', rp.round_no,
    'status', 'completed',
    'matches', rp.matches,
    'resting', (
      SELECT coalesce(jsonb_agg(sps.player_id ORDER BY sps.player_id), '[]'::jsonb)
      FROM public.session_player_state sps
      WHERE sps.session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
        AND sps.checked_out_at IS NULL
        AND NOT (sps.player_id = ANY(rp.playing_ids))
    ),
    'started_at', rp.started_at,
    'ended_at', rp.ended_at
  ) AS round_row
FROM round_playing rp
ORDER BY rp.round_no;
