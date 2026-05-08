-- Add host_gender and host_skill to owner_sessions metadata or handle in RPC
-- We will update the players table directly for the host if provided.

-- Update create_owner_session to handle host profile updates
CREATE OR REPLACE FUNCTION public.create_owner_session(
  p_court_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_elo_min integer,
  p_elo_max integer,
  p_is_ranked boolean,
  p_max_players integer,
  p_fill_deadline timestamptz,
  p_total_cost integer,
  p_require_approval boolean,
  p_format_type text,
  p_sub_court_numbers integer[],
  p_is_unlimited boolean,
  p_host_is_playing boolean default true,
  p_format_metadata jsonb default '{}'::jsonb,
  p_require_results boolean default false,
  p_match_format text default 'doubles',
  p_host_gender text default null,
  p_host_skill float8 default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_slot_id uuid;
  v_session_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Update host profile if gender/skill provided
  if p_host_gender is not null then
    update public.players set gender = p_host_gender where id = v_uid;
  end if;
  if p_host_skill is not null then
    update public.players set pvna = p_host_skill where id = v_uid;
  end if;

  insert into public.court_slots (court_id, start_time, end_time, price, status)
  values (p_court_id, p_start_time, p_end_time, 0, 'booked')
  returning id into v_slot_id;

  insert into public.sessions (
    host_id, slot_id, elo_min, elo_max, is_ranked, max_players, status, fill_deadline, total_cost, require_approval, court_booking_status, court_id, is_owner_managed
  ) values (
    v_uid, v_slot_id, p_elo_min, p_elo_max, coalesce(p_is_ranked, true),
    case when p_is_unlimited then 999 else p_max_players end,
    'open', p_fill_deadline, p_total_cost, coalesce(p_require_approval, false), 'confirmed', p_court_id, true
  )
  returning id into v_session_id;

  insert into public.owner_sessions (
    id, court_id, format_type, sub_court_numbers, is_unlimited, custom_max_players, host_is_playing, format_metadata, require_results, total_cost, match_format
  ) values (
    v_session_id, p_court_id, p_format_type, p_sub_court_numbers, p_is_unlimited, p_max_players, p_host_is_playing, 
    p_format_metadata || jsonb_build_object('cost_per_person', p_total_cost, 'match_format', p_match_format, 'host_gender', p_host_gender, 'host_skill', p_host_skill), 
    p_require_results, p_total_cost, p_match_format
  );

  IF p_host_is_playing THEN
    insert into public.session_players (session_id, player_id, status) values (v_session_id, v_uid, 'confirmed');
  END IF;

  return v_session_id;
end;
$$;

-- Update update_owner_session to handle host profile updates
CREATE OR REPLACE FUNCTION public.update_owner_session(
  p_session_id uuid, 
  p_court_id uuid, 
  p_start_time timestamptz, 
  p_end_time timestamptz, 
  p_elo_min integer, 
  p_elo_max integer, 
  p_is_ranked boolean, 
  p_max_players integer, 
  p_fill_deadline timestamptz, 
  p_total_cost integer, 
  p_require_approval boolean, 
  p_format_type text, 
  p_sub_court_numbers integer[], 
  p_is_unlimited boolean, 
  p_host_is_playing boolean default true, 
  p_format_metadata jsonb default '{}'::jsonb, 
  p_require_results boolean default false, 
  p_match_format text default 'doubles',
  p_host_gender text default null,
  p_host_skill float8 default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_slot_id uuid; v_old_is_playing boolean;
begin
  v_uid := auth.uid();
  select s.slot_id, os.host_is_playing into v_slot_id, v_old_is_playing
  from public.sessions s join public.owner_sessions os on os.id = s.id
  where s.id = p_session_id and s.host_id = v_uid for update;

  if v_slot_id is null then raise exception 'Not found'; end if;

  -- Update host profile if gender/skill provided
  if p_host_gender is not null then
    update public.players set gender = p_host_gender where id = v_uid;
  end if;
  if p_host_skill is not null then
    update public.players set pvna = p_host_skill where id = v_uid;
  end if;

  update public.court_slots set court_id = p_court_id, start_time = p_start_time, end_time = p_end_time where id = v_slot_id;
  update public.sessions set 
    elo_min = p_elo_min, 
    elo_max = p_elo_max, 
    is_ranked = coalesce(p_is_ranked, true), 
    max_players = case when p_is_unlimited then 999 else p_max_players end, 
    fill_deadline = p_fill_deadline, 
    total_cost = p_total_cost, 
    require_approval = coalesce(p_require_approval, false),
    court_id = p_court_id,
    is_owner_managed = true
  where id = p_session_id;
  update public.owner_sessions set court_id = p_court_id, format_type = p_format_type, sub_court_numbers = p_sub_court_numbers, is_unlimited = p_is_unlimited, custom_max_players = p_max_players, host_is_playing = p_host_is_playing, format_metadata = p_format_metadata || jsonb_build_object('cost_per_person', p_total_cost, 'match_format', p_match_format, 'host_gender', p_host_gender, 'host_skill', p_host_skill), require_results = p_require_results, total_cost = p_total_cost, match_format = p_match_format where id = p_session_id;

  IF p_host_is_playing AND NOT COALESCE(v_old_is_playing, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.session_players WHERE session_id = p_session_id AND player_id = v_uid) THEN
      insert into public.session_players (session_id, player_id, status) values (p_session_id, v_uid, 'confirmed');
    END IF;
  ELSIF NOT p_host_is_playing AND COALESCE(v_old_is_playing, true) THEN
    delete from public.session_players where session_id = p_session_id and player_id = v_uid;
  END IF;
  return p_session_id;
end;
$$;
