-- Close live matches left behind by abandoned sessions, and the sessions themselves.
-- Runs inside a transaction and rolls back; the counts it prints are what a real run would change.
--
-- Why 4 hours: across 4912 completed matches p95 is 16 minutes and p99 is 93. Only 8 ever exceeded four
-- hours, 0.16%, and those are themselves likely abandoned-then-recorded. The rows being cleaned here are
-- days old — 62 of them sit in sessions still marked playing, median age 6.5 days.
--
-- Why it matters: to the engine a player inside a live row is busy, so a row that never completes makes
-- four players permanently unseatable. Session 58181280 is recorded in TASK.md as "asked for 2 courts,
-- 21 players free, returned 0" and has 8 players locked this way; a1cef762 has 24 locked and no
-- completed matches at all.
--
-- Status choice: 'cancelled', not 'completed'. These matches were never played, and marking them
-- completed would feed fictional results into every counter that reads match history.

begin;

create temp table t_before on commit drop as
select
  (select count(*)::int from public.session_live_matches where status = 'live') as live_rows,
  (select count(*)::int from public.session_live_matches m join public.sessions s on s.id = m.session_id
    where m.status = 'live' and s.status = 'playing') as live_in_playing_sessions,
  (select count(*)::int from public.sessions where status = 'playing') as playing_sessions;

-- 1. Matches abandoned mid-play.
with stale as (
  select id from public.session_live_matches
  where status = 'live'
    and started_at is not null
    and started_at < now() - interval '4 hours'
)
update public.session_live_matches m
set status = 'cancelled', ended_at = coalesce(m.ended_at, now())
from stale
where m.id = stale.id;

-- 2. Suggestions that were never started either.
update public.session_live_matches
set status = 'cancelled'
where status = 'suggested'
  and created_at is not null
  and created_at < now() - interval '4 hours';

-- 3. Sessions with nothing left running are over, whatever they still claim.
update public.sessions s
set status = 'finished'
where s.status = 'playing'
  and not exists (
    select 1 from public.session_live_matches m
    where m.session_id = s.id and m.status in ('live', 'suggested')
  )
  -- NEWEST match must be old, not merely some match. A session between rounds has everything completed
  -- and still has matches from hours ago; keying off "some old match" would close it while people are
  -- standing on court waiting for the next round.
  and (
    select max(greatest(m.created_at, coalesce(m.ended_at, m.created_at)))
    from public.session_live_matches m where m.session_id = s.id
  ) < now() - interval '4 hours';

select
  b.live_rows as live_rows_before,
  (select count(*)::int from public.session_live_matches where status = 'live') as live_rows_after,
  b.live_in_playing_sessions as locked_before,
  (select count(*)::int from public.session_live_matches m join public.sessions s on s.id = m.session_id
    where m.status = 'live' and s.status = 'playing') as locked_after,
  b.playing_sessions as playing_before,
  (select count(*)::int from public.sessions where status = 'playing') as playing_after
from t_before b;

rollback;
