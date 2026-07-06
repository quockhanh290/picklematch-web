alter table public.courts
  add column if not exists booking_url text;

alter table public.sessions
  add column if not exists court_booking_status text not null default 'unconfirmed',
  add column if not exists booking_reference text,
  add column if not exists booking_name text,
  add column if not exists booking_phone text,
  add column if not exists booking_notes text,
  add column if not exists booking_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_court_booking_status_check'
  ) then
    alter table public.sessions
      add constraint sessions_court_booking_status_check
      check (court_booking_status in ('confirmed', 'unconfirmed'));
  end if;
end $$;
