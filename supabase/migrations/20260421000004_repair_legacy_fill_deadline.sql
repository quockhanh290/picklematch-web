-- Repair legacy sessions created before the new "deadline before start time" logic.
-- Expected range for fill_deadline: [start_time - 2h, start_time - 30m].
-- Any upcoming session outside this range is normalized to start_time - 1h.

update public.sessions s
set fill_deadline = cs.start_time - interval '1 hour'
from public.court_slots cs
where s.slot_id = cs.id
  and s.status in ('open', 'closed_recruitment')
  and cs.start_time > now()
  and (
    s.fill_deadline is null
    or s.fill_deadline < cs.start_time - interval '2 hours'
    or s.fill_deadline > cs.start_time - interval '30 minutes'
  );

-- Re-evaluate status after repairing deadlines (without calling auth-guarded RPC).
update public.sessions
set status = 'open'
where status = 'closed_recruitment'
  and fill_deadline is not null
  and fill_deadline > now();

update public.sessions
set status = 'closed_recruitment'
where status = 'open'
  and fill_deadline is not null
  and fill_deadline <= now();
