create index if not exists idx_session_players_session_id
on public.session_players(session_id);

create index if not exists idx_ratings_session_id_rater_id
on public.ratings(session_id, rater_id);

create index if not exists idx_join_requests_match_id_status
on public.join_requests(match_id, status);
