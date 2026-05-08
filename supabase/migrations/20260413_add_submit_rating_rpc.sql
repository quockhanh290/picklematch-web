drop policy if exists "Player tự rate" on public.ratings;

create or replace function public.submit_rating(
  p_session_id uuid,
  p_rated_id uuid,
  p_tags text[] default '{}'::text[],
  p_no_show boolean default false,
  p_skill_validation text default 'matched'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_rating_id uuid;
  v_session_host_id uuid;
  v_results_status text;
  v_session_end timestamptz;
  v_reveal_at timestamptz;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_rated_id is null then
    raise exception 'Rated player is required';
  end if;

  if p_skill_validation not in ('weaker', 'matched', 'outclass') then
    raise exception 'Invalid skill validation';
  end if;

  select s.host_id, s.results_status, cs.end_time
  into v_session_host_id, v_results_status, v_session_end
  from public.sessions s
  join public.court_slots cs on cs.id = s.slot_id
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_results_status <> 'finalized' then
    raise exception 'Session results must be finalized before rating';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = v_uid
      and sp.status = 'confirmed'
  ) then
    raise exception 'Only confirmed players can submit ratings for this session';
  end if;

  if not exists (
    select 1
    from public.session_players sp
    where sp.session_id = p_session_id
      and sp.player_id = p_rated_id
      and sp.status = 'confirmed'
  ) then
    raise exception 'Rated player is not a confirmed participant in this session';
  end if;

  if p_rated_id = v_uid then
    raise exception 'You cannot rate yourself';
  end if;

  if exists (
    select 1
    from public.ratings r
    where r.session_id = p_session_id
      and r.rater_id = v_uid
      and r.rated_id = p_rated_id
  ) then
    raise exception 'You have already rated this player for the session';
  end if;

  v_reveal_at := coalesce(v_session_end, now()) + interval '24 hours';

  insert into public.ratings (
    session_id,
    rater_id,
    rated_id,
    tags,
    no_show,
    skill_validation,
    is_hidden,
    reveal_at
  )
  values (
    p_session_id,
    v_uid,
    p_rated_id,
    case when p_no_show then '{}'::text[] else coalesce(p_tags, '{}'::text[]) end,
    p_no_show,
    p_skill_validation,
    true,
    v_reveal_at
  )
  returning id into v_rating_id;

  return v_rating_id;
end;
$$;

grant execute on function public.submit_rating(uuid, uuid, text[], boolean, text) to authenticated;
