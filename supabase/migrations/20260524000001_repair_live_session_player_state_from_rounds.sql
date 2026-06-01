-- Rebuild live suggester player counters from completed rounds.
-- This is intended for sessions that were affected by older per-match rest updates.

create or replace function public.repair_live_session_player_state_from_rounds(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_next_version bigint;
  v_changed_player_state jsonb := '[]'::jsonb;
begin
  select host_id
  into v_host_id
  from public.sessions
  where id = p_session_id
  for update;

  if v_host_id is null then
    raise exception 'Session not found';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can repair live session state';
  end if;

  with completed_live_rounds as (
    select
      slm.round_no,
      jsonb_agg(
        jsonb_build_object(
          'team_a', slm.team_a,
          'team_b', slm.team_b
        )
        order by slm.court_idx nulls last, slm.sequence_no
      ) as matches,
      min(slm.started_at) as started_at,
      max(slm.ended_at) as ended_at
    from public.session_live_matches slm
    where slm.session_id = p_session_id
      and slm.round_no is not null
    group by slm.round_no
    having
      count(*) filter (where slm.status = 'completed') > 0
      and count(*) filter (where slm.status not in ('completed', 'cancelled')) = 0
  ),
  completed_session_rounds as (
    select
      sr.round_no,
      sr.matches,
      sr.started_at,
      sr.ended_at
    from public.session_rounds sr
    where sr.session_id = p_session_id
      and sr.status = 'completed'
  ),
  all_rounds as (
    select * from completed_session_rounds
    union all
    select * from completed_live_rounds
  ),
  round_players as (
    select
      r.round_no,
      (player_id_text)::uuid as player_id,
      true as played,
      r.started_at,
      r.ended_at
    from all_rounds r
    cross join lateral jsonb_array_elements(coalesce(r.matches, '[]'::jsonb)) match
    cross join lateral (
      select jsonb_array_elements_text(match -> 'team_a') as player_id_text
      union
      select jsonb_array_elements_text(match -> 'team_b') as player_id_text
    ) played
  ),
  round_windows as (
    select
      round_no,
      min(started_at) as started_at,
      max(ended_at) as ended_at
    from all_rounds
    group by round_no
  ),
  round_present as (
    select
      rw.round_no,
      sps.player_id,
      coalesce(rp.played, false) as played
    from round_windows rw
    join public.session_player_state sps
      on sps.session_id = p_session_id
     and (
       (rw.started_at is null and rw.ended_at is null and sps.checked_out_at is null)
       or (
         sps.checked_in_at <= coalesce(rw.ended_at, rw.started_at, now())
         and coalesce(sps.checked_out_at, 'infinity'::timestamptz) >= coalesce(rw.started_at, rw.ended_at, '-infinity'::timestamptz)
       )
     )
    left join round_players rp
      on rp.round_no = rw.round_no
     and rp.player_id = sps.player_id
  ),
  player_rounds as (
    select
      sps.player_id,
      rp.round_no,
      coalesce(rp.played, false) as played
    from public.session_player_state sps
    left join round_present rp
      on rp.player_id = sps.player_id
    where sps.session_id = p_session_id
  ),
  ordered as (
    select
      player_id,
      round_no,
      played,
      sum(case when played then 1 else 0 end) over (
        partition by player_id
        order by round_no
        rows between unbounded preceding and current row
      ) as play_group
    from player_rounds
    where round_no is not null
  ),
  computed as (
    select
      sps.player_id,
      coalesce(count(*) filter (where o.played), 0)::int as matches_played,
      coalesce(max(o.round_no) filter (where o.played), -1)::int as last_played_round,
      coalesce(count(*) filter (
        where o.played
          and o.round_no > coalesce((
            select max(o2.round_no)
            from ordered o2
            where o2.player_id = sps.player_id
              and not o2.played
          ), -1)
      ), 0)::int as consecutive_play,
      coalesce(count(*) filter (
        where not o.played
          and o.round_no > coalesce((
            select max(o2.round_no)
            from ordered o2
            where o2.player_id = sps.player_id
              and o2.played
          ), -1)
      ), 0)::int as consecutive_rest
    from public.session_player_state sps
    left join ordered o
      on o.player_id = sps.player_id
    where sps.session_id = p_session_id
    group by sps.player_id
  ),
  updated as (
    update public.session_player_state sps
    set
      matches_played = computed.matches_played,
      last_played_round = computed.last_played_round,
      consecutive_play = computed.consecutive_play,
      consecutive_rest = computed.consecutive_rest
    from computed
    where sps.session_id = p_session_id
      and sps.player_id = computed.player_id
      and (
        sps.matches_played is distinct from computed.matches_played
        or sps.last_played_round is distinct from computed.last_played_round
        or sps.consecutive_play is distinct from computed.consecutive_play
        or sps.consecutive_rest is distinct from computed.consecutive_rest
      )
    returning sps.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.player_id), '[]'::jsonb)
  into v_changed_player_state
  from updated;

  update public.sessions
  set live_state_version = live_state_version + 1
  where id = p_session_id
  returning live_state_version into v_next_version;

  insert into public.suggester_decision_events(session_id, round_no, event_type, payload)
  values (
    p_session_id,
    null,
    'live_state_repaired',
    jsonb_build_object(
      'changed_player_state_count', jsonb_array_length(v_changed_player_state)
    )
  );

  return jsonb_build_object(
    'live_state_version', v_next_version,
    'changed_player_state', v_changed_player_state
  );
end;
$$;

revoke all on function public.repair_live_session_player_state_from_rounds(uuid) from public, anon, authenticated;
grant execute on function public.repair_live_session_player_state_from_rounds(uuid) to authenticated;
