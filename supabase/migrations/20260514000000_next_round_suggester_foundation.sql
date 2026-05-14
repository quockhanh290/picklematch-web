-- Next Round Suggester foundation
-- Host-managed live session presence, pair history, and per-round records.

create table if not exists public.session_player_state (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  group_id text,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  matches_played int not null default 0,
  last_played_round int not null default -1,
  consecutive_rest int not null default 0,
  consecutive_play int not null default 0,
  opted_rest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, player_id),
  check (matches_played >= 0),
  check (last_played_round >= -1),
  check (consecutive_rest >= 0),
  check (consecutive_play >= 0),
  check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create table if not exists public.session_pair_history (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_a uuid not null references public.players(id) on delete cascade,
  player_b uuid not null references public.players(id) on delete cascade,
  partner_count int not null default 0,
  opponent_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, player_a, player_b),
  check (player_a < player_b),
  check (partner_count >= 0),
  check (opponent_count >= 0)
);

create table if not exists public.session_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  status text not null check (status in ('proposed', 'active', 'completed')),
  matches jsonb not null,
  resting jsonb not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, round_no),
  check (round_no >= 0),
  check (jsonb_typeof(matches) = 'array'),
  check (jsonb_typeof(resting) = 'array'),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists idx_session_player_state_present
on public.session_player_state(session_id, checked_out_at, opted_rest);

create index if not exists idx_session_player_state_player
on public.session_player_state(player_id);

create index if not exists idx_session_pair_history_session
on public.session_pair_history(session_id);

create index if not exists idx_session_rounds_session_status
on public.session_rounds(session_id, status);

create or replace function public.touch_next_round_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_session_player_state_updated_at on public.session_player_state;
create trigger tr_session_player_state_updated_at
before update on public.session_player_state
for each row execute function public.touch_next_round_updated_at();

drop trigger if exists tr_session_pair_history_updated_at on public.session_pair_history;
create trigger tr_session_pair_history_updated_at
before update on public.session_pair_history
for each row execute function public.touch_next_round_updated_at();

drop trigger if exists tr_session_rounds_updated_at on public.session_rounds;
create trigger tr_session_rounds_updated_at
before update on public.session_rounds
for each row execute function public.touch_next_round_updated_at();

create or replace function public.is_live_session_host(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.host_id = auth.uid()
  );
$$;

create or replace function public.is_live_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = auth.uid()
      and sp.status = 'confirmed'
  );
$$;

create or replace function public.can_read_live_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_live_session_host(p_session_id)
    or public.is_live_session_participant(p_session_id);
$$;

alter table public.session_player_state enable row level security;
alter table public.session_pair_history enable row level security;
alter table public.session_rounds enable row level security;

drop policy if exists "Live session player state readable by host and participants"
on public.session_player_state;
create policy "Live session player state readable by host and participants"
on public.session_player_state for select
to authenticated
using (public.can_read_live_session(session_id));

drop policy if exists "Hosts can write live session player state"
on public.session_player_state;
create policy "Hosts can write live session player state"
on public.session_player_state for all
to authenticated
using (public.is_live_session_host(session_id))
with check (public.is_live_session_host(session_id));

drop policy if exists "Pair history readable by host and participants"
on public.session_pair_history;
create policy "Pair history readable by host and participants"
on public.session_pair_history for select
to authenticated
using (public.can_read_live_session(session_id));

drop policy if exists "Hosts can write pair history"
on public.session_pair_history;
create policy "Hosts can write pair history"
on public.session_pair_history for all
to authenticated
using (public.is_live_session_host(session_id))
with check (public.is_live_session_host(session_id));

drop policy if exists "Rounds readable by host and participants"
on public.session_rounds;
create policy "Rounds readable by host and participants"
on public.session_rounds for select
to authenticated
using (public.can_read_live_session(session_id));

drop policy if exists "Hosts can write rounds"
on public.session_rounds;
create policy "Hosts can write rounds"
on public.session_rounds for all
to authenticated
using (public.is_live_session_host(session_id))
with check (public.is_live_session_host(session_id));
