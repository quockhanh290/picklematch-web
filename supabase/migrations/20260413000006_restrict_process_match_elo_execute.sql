revoke execute on function public.process_match_elo(uuid) from authenticated;
grant execute on function public.process_match_elo(uuid) to service_role;
