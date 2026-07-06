create or replace function public.delete_player_account(target_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hosted_session_ids uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[])
    into hosted_session_ids
  from public.sessions
  where host_id = target_player_id;

  if array_length(hosted_session_ids, 1) is not null then
    delete from public.session_players
    where session_id = any(hosted_session_ids);

    delete from public.session_requests
    where session_id = any(hosted_session_ids);

    delete from public.ratings
    where session_id = any(hosted_session_ids);

    delete from public.sessions
    where id = any(hosted_session_ids);
  end if;

  delete from public.session_players
  where player_id = target_player_id;

  delete from public.session_requests
  where player_id = target_player_id;

  delete from public.ratings
  where rater_id = target_player_id
     or rated_id = target_player_id;

  delete from public.notifications
  where player_id = target_player_id;

  delete from public.players
  where id = target_player_id;
end;
$$;
