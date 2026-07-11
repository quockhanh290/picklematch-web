-- Canonical logical-cycle identity for rolling court lanes.
-- Existing rows intentionally remain null: historical round_no values may be
-- ambiguous, so readers must keep their legacy reconstruction fallback.

alter table public.session_live_matches
  add column if not exists cycle_no int;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_live_matches_cycle_no_nonnegative'
      and conrelid = 'public.session_live_matches'::regclass
  ) then
    alter table public.session_live_matches
      add constraint session_live_matches_cycle_no_nonnegative
      check (cycle_no is null or cycle_no >= 0) not valid;
  end if;
end;
$$;

create index if not exists idx_session_live_matches_cycle
  on public.session_live_matches(session_id, cycle_no, sequence_no)
  where cycle_no is not null;

comment on column public.session_live_matches.cycle_no is
  'Canonical rolling-lane logical cycle. Null only for legacy rows requiring sequence reconstruction.';
