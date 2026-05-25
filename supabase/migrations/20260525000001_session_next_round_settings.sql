create table if not exists public.session_next_round_settings (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  court_count_override integer null check (court_count_override is null or court_count_override >= 1),
  court_preset text not null default 'balanced' check (court_preset in ('balanced', 'play_more', 'relaxed')),
  court_duration_min integer not null default 120 check (court_duration_min >= 15),
  pvna_tolerance numeric not null default 0.5 check (pvna_tolerance >= 0),
  target_rounds integer null check (target_rounds is null or target_rounds >= 1),
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tr_session_next_round_settings_updated_at on public.session_next_round_settings;
create trigger tr_session_next_round_settings_updated_at
before update on public.session_next_round_settings
for each row execute function public.touch_next_round_updated_at();

alter table public.session_next_round_settings enable row level security;

drop policy if exists "Next round settings readable by host and participants" on public.session_next_round_settings;
create policy "Next round settings readable by host and participants"
on public.session_next_round_settings
for select
using (
  exists (
    select 1
    from public.sessions s
    left join public.session_players sp
      on sp.session_id = s.id and sp.player_id = auth.uid()
    where s.id = session_next_round_settings.session_id
      and (s.host_id = auth.uid() or sp.player_id is not null)
  )
);

drop policy if exists "Hosts can insert next round settings" on public.session_next_round_settings;
create policy "Hosts can insert next round settings"
on public.session_next_round_settings
for insert
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = session_next_round_settings.session_id
      and s.host_id = auth.uid()
  )
);

drop policy if exists "Hosts can update next round settings" on public.session_next_round_settings;
create policy "Hosts can update next round settings"
on public.session_next_round_settings
for update
using (
  exists (
    select 1
    from public.sessions s
    where s.id = session_next_round_settings.session_id
      and s.host_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = session_next_round_settings.session_id
      and s.host_id = auth.uid()
  )
);
