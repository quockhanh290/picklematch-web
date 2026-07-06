with sessions_to_backfill as (
  select sp.session_id
  from public.session_players sp
  group by sp.session_id
  having count(*) > 0
     and count(*) filter (where sp.team_no in (1, 2)) = 0
),
ranked_players as (
  select
    sp.session_id,
    sp.player_id,
    row_number() over (
      partition by sp.session_id
      order by coalesce(p.current_elo, p.elo, 0) desc, p.name asc, sp.player_id asc
    ) as player_rank
  from public.session_players sp
  join sessions_to_backfill stb on stb.session_id = sp.session_id
  join public.players p on p.id = sp.player_id
)
update public.session_players sp
set team_no = case when rp.player_rank % 2 = 1 then 1 else 2 end
from ranked_players rp
where sp.session_id = rp.session_id
  and sp.player_id = rp.player_id
  and sp.team_no is null;
