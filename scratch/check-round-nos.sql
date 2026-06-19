-- Check round_no distribution để detect dirty data
SELECT
  round_no,
  status,
  count(*) AS match_count,
  count(DISTINCT session_id) AS sessions,
  min(started_at) AS first_started,
  max(ended_at) AS last_ended
FROM public.session_live_matches
WHERE session_id = 'c730fbb2-ca74-401f-938c-78b75f2ab4e9'
GROUP BY round_no, status
ORDER BY round_no, status;
