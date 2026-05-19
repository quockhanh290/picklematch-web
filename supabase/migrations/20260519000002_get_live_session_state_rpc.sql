create or replace function public.get_live_session_state(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'playerRows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'session_id', sps.session_id,
            'player_id', sps.player_id,
            'group_id', sps.group_id,
            'checked_in_at', sps.checked_in_at,
            'checked_out_at', sps.checked_out_at,
            'matches_played', sps.matches_played,
            'last_played_round', sps.last_played_round,
            'consecutive_rest', sps.consecutive_rest,
            'consecutive_play', sps.consecutive_play,
            'opted_rest', sps.opted_rest,
            'players', jsonb_build_object(
              'pvna', p.pvna,
              'current_elo', p.current_elo,
              'elo', p.elo,
              'gender', p.gender,
              'partner_gender_pref', p.partner_gender_pref,
              'opponent_gender_pref', p.opponent_gender_pref
            ),
            'session_players', jsonb_build_object(
              'metadata', sp.metadata
            )
          )
          order by sps.checked_in_at asc
        )
        from public.session_player_state sps
        left join public.players p on p.id = sps.player_id
        left join public.session_players sp
          on sp.session_id = sps.session_id
          and sp.player_id = sps.player_id
        where sps.session_id = p_session_id
      ),
      '[]'::jsonb
    ),
    'pairRows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'session_id', sph.session_id,
            'player_a', sph.player_a,
            'player_b', sph.player_b,
            'partner_count', sph.partner_count,
            'opponent_count', sph.opponent_count
          )
          order by sph.player_a asc
        )
        from public.session_pair_history sph
        where sph.session_id = p_session_id
      ),
      '[]'::jsonb
    ),
    'roundRows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sr.id,
            'session_id', sr.session_id,
            'round_no', sr.round_no,
            'status', sr.status,
            'matches', sr.matches,
            'resting', sr.resting,
            'started_at', sr.started_at,
            'ended_at', sr.ended_at
          )
          order by sr.round_no asc
        )
        from public.session_rounds sr
        where sr.session_id = p_session_id
      ),
      '[]'::jsonb
    ),
    'preferenceRows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'player_id', sp.player_id,
            'metadata', sp.metadata,
            'players', jsonb_build_object(
              'pvna', p.pvna,
              'current_elo', p.current_elo,
              'elo', p.elo,
              'gender', p.gender,
              'partner_gender_pref', p.partner_gender_pref,
              'opponent_gender_pref', p.opponent_gender_pref
            )
          )
          order by sp.player_id asc
        )
        from public.session_players sp
        left join public.players p on p.id = sp.player_id
        where sp.session_id = p_session_id
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_live_session_state(uuid) from public, anon, authenticated;
grant execute on function public.get_live_session_state(uuid) to service_role;
