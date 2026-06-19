-- Tìm session đang active và check round distribution
WITH active_sessions AS (
  SELECT DISTINCT session_id, max(updated_at) AS last_activity
  FROM public.session_live_matches
  WHERE status IN ('live', 'suggested', 'completed')
    AND updated_at > now() - interval '3 hours'
  GROUP BY session_id
  ORDER BY last_activity DESC
  LIMIT 3
),
round_dist AS (
  SELECT
    slm.session_id,
    slm.round_no,
    slm.status,
    count(*) AS courts,
    min(slm.started_at) AS started_at
  FROM public.session_live_matches slm
  JOIN active_sessions a ON a.session_id = slm.session_id
  GROUP BY slm.session_id, slm.round_no, slm.status
  ORDER BY slm.session_id, slm.round_no, slm.status
)
SELECT * FROM round_dist;
