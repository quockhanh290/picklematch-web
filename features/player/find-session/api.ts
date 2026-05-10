import { supabase } from '@/lib/supabase'
import { Session, PlayerQueueProfile } from './types'

export async function fetchSessionsApi(currentUserId: string | null): Promise<Session[]> {
  const [sessionsResult, pendingRequestsResult] = await Promise.all([
    supabase
      .from('sessions')
      .select(
        `id, host_id, elo_min, elo_max, max_players, status, court_booking_status,
        host:host_id ( id, name, is_provisional, current_elo, elo, self_assessed_level, skill_label ),
        slot:slot_id (
          start_time, end_time, price,
          court:court_id ( id, name, address, city, lat, lng )
        ),
        session_players ( player_id ),
        owner_sessions ( id, format_type ),
        total_cost`,
      )
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50),
    currentUserId
      ? supabase
          .from('join_requests')
          .select('match_id')
          .eq('player_id', currentUserId)
          .eq('status', 'pending')
      : Promise.resolve({ data: [] }),
  ])

  const { data, error } = sessionsResult
  const pendingRequestIds = new Set((pendingRequestsResult.data ?? []).map((r: any) => r.match_id))

  if (error || !data) {
    if (error) console.error('[FindSessionApi] fetchSessions failed:', error.message)
    return []
  }

  const normalized = data.map((s: any) => {
    const ownerData = Array.isArray(s.owner_sessions) ? s.owner_sessions[0] : s.owner_sessions
    return {
      ...s,
      format_type: ownerData?.format_type || s.format_type || 'social',
      player_count: (s.session_players ?? []).length,
      lat: s.slot?.court?.lat,
      lng: s.slot?.court?.lng,
    }
  }) as Session[]

  if (currentUserId) {
    return normalized.map((session) => {
      const joined = (session.session_players ?? []).some((player: any) => player.player_id === currentUserId)
      const hosted = session.host_id === currentUserId
      const requested = pendingRequestIds.has(session.id)
      return {
        ...session,
        is_joined: joined,
        is_hosted: hosted,
        is_requested: requested
      }
    })
  }

  return normalized
}

export async function fetchPlayerProfileApi(userId: string): Promise<PlayerQueueProfile | null> {
  const { data, error } = await supabase
    .from('players')
    .select('id, city, current_elo, elo, self_assessed_level, skill_label, favorite_court_ids')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[FindSessionApi] fetchPlayerProfile failed:', error.message)
    return null
  }

  return data as PlayerQueueProfile
}
