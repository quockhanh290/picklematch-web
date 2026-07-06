alter table public.players
  add column if not exists elo integer default 1000,
  add column if not exists elo_matches_played integer default 0,
  add column if not exists onboarding_completed boolean default false,
  add column if not exists skill_tier text default 'beginner',
  add column if not exists play_preference text;

update public.players
set
  onboarding_completed = true,
  skill_tier = coalesce(
    skill_tier,
    case
      when coalesce(current_elo, elo, 1000) < 900 then 'beginner'
      when coalesce(current_elo, elo, 1000) < 1050 then 'basic'
      when coalesce(current_elo, elo, 1000) < 1150 then 'intermediate'
      when coalesce(current_elo, elo, 1000) < 1300 then 'upper_intermediate'
      when coalesce(current_elo, elo, 1000) < 1450 then 'advanced'
      else 'elite'
    end
  )
where coalesce(self_assessed_level, '') <> ''
   or coalesce(skill_label, '') <> ''
   or coalesce(current_elo, elo, 0) > 0;
