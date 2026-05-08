alter table public.players
  add column if not exists self_assessed_level varchar,
  add column if not exists current_elo integer,
  add column if not exists is_provisional boolean not null default false,
  add column if not exists placement_matches_played integer not null default 0;
