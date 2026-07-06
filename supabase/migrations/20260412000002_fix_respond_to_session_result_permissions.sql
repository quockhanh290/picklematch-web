create or replace function public.respond_to_session_result(
  p_session_id uuid,
  p_response text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_host_id uuid;
  v_deadline timestamptz;
  v_updated_rows integer := 0;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select host_id, results_confirmation_deadline
  into v_host_id, v_deadline
  from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_uid = v_host_id then
    raise exception 'Host cannot use player confirmation flow';
  end if;

  if p_response not in ('confirmed', 'disputed') then
    raise exception 'Invalid response';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
      and sp.status = 'confirmed'
  ) then
    raise exception 'Only confirmed players can respond to session results';
  end if;

  update public.session_players
  set
    result_confirmation_status = p_response,
    result_confirmed_at = case when p_response = 'confirmed' then now() else result_confirmed_at end,
    result_disputed_at = case when p_response = 'disputed' then now() else result_disputed_at end,
    result_dispute_note = case when p_response = 'disputed' then nullif(trim(p_note), '') else null end
  where session_id = p_session_id
    and player_id = v_uid
    and status = 'confirmed';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 0 then
    raise exception 'Could not record your response for this session';
  end if;

  if p_response = 'disputed' then
    update public.sessions
    set results_status = 'disputed'
    where id = p_session_id;

    return 'disputed';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id <> v_host_id
      and sp.status = 'confirmed'
      and sp.result_confirmation_status <> 'confirmed'
  ) then
    perform public.finalize_session_results(p_session_id);
    return 'finalized';
  end if;

  if v_deadline is not null and v_deadline <= now() then
    perform public.finalize_session_results(p_session_id);
    return 'finalized';
  end if;

  return 'confirmed';
end;
$$;

grant execute on function public.respond_to_session_result(uuid, text, text) to authenticated;
