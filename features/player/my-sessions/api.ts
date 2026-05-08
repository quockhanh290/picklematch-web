import { supabase } from '@/lib/supabase'
import { MySession } from './types'

export async function fetchMySessionsApi(userId: string): Promise<MySession[]> {
  const { data, error } = await supabase.rpc('get_my_sessions_overview')
  if (error) {
    console.warn('[MySessionsApi] get_my_sessions_overview failed:', error.message)
  }

  let rpcSessions: MySession[] = (data ?? []).map((session: any) => ({
    id: session.id,
    status: session.status,
    court_booking_status: session.court_booking_status,
    host_id: session.host_id ?? null,
    role: session.role,
    request_status: session.request_status,
    results_status: session.results_status ?? null,
    start_time: session.start_time,
    end_time: session.end_time,
    court_name: session.court_name ?? 'Kèo Pickleball',
    court_city: session.court_city ?? '',
    court_address: session.court_address ?? '',
    host_name: session.host_name ?? (session.role === 'host' ? 'Bạn' : 'Ẩn danh'),
    player_count: session.player_count ?? 0,
    max_players: session.max_players ?? 0,
    elo_min: session.elo_min ?? null,
    elo_max: session.elo_max ?? null,
    has_rated: session.has_rated ?? false,
    is_ranked: session.is_ranked ?? true,
  }))

  const rpcSessionIds = Array.from(new Set(rpcSessions.map((session) => session.id).filter(Boolean)))
  if (rpcSessionIds.length === 0) return rpcSessions

  const [sessionMetaResult, userResultsResult, myRatingsResult, hostPendingResult, playerPendingResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, host_id, results_status, is_ranked')
      .in('id', rpcSessionIds),
    supabase
      .from('session_players')
      .select('session_id, proposed_result')
      .eq('player_id', userId)
      .in('session_id', rpcSessionIds),
    supabase
      .from('ratings')
      .select('session_id')
      .eq('rater_id', userId)
      .in('session_id', rpcSessionIds),
    supabase
      .from('join_requests')
      .select('match_id, sessions!inner(host_id)')
      .eq('status', 'pending')
      .eq('sessions.host_id', userId),
    supabase
      .from('join_requests')
      .select('match_id')
      .eq('player_id', userId)
      .eq('status', 'pending'),
  ])

  const sessionMetaRows = sessionMetaResult.data ?? []
  const userResultsRows = userResultsResult.data ?? []
  const myRatingsRows = myRatingsResult.data ?? []
  const hostPendingRows = hostPendingResult.data ?? []
  const playerPendingRows = playerPendingResult.data ?? []

  const hostIdBySessionId = new Map<string, string>(
    sessionMetaRows
      .filter((row: any) => row?.id && row?.host_id)
      .map((row: any) => [row.id as string, row.host_id as string]),
  )
  const resultsStatusBySessionId = new Map<string, MySession['results_status']>(
    sessionMetaRows
      .filter((row: any) => row?.id)
      .map((row: any) => [row.id as string, (row.results_status as MySession['results_status']) ?? null]),
  )
  const isRankedBySessionId = new Map<string, boolean>(
    sessionMetaRows
      .filter((row: any) => row?.id)
      .map((row: any) => [row.id as string, row.is_ranked ?? true]),
  )

  const userResultBySessionId = new Map<string, MySession['user_result']>(
    userResultsRows
      .filter((row: any) => row?.session_id)
      .map((row: any) => [row.session_id as string, (row.proposed_result as MySession['user_result']) ?? null]),
  )

  const ratedSessionIds = new Set<string>(
    myRatingsRows
      .map((row: any) => row?.session_id as string | null)
      .filter((sessionId: string | null): sessionId is string => Boolean(sessionId)),
  )

  const hostPendingIds = new Set<string>(hostPendingRows.map((row: any) => row.match_id).filter(Boolean))
  const playerPendingIds = new Set<string>(playerPendingRows.map((row: any) => row.match_id).filter(Boolean))

  const byKey = new Map<string, MySession>()
  
  // First pass: map RPC sessions
  for (const session of rpcSessions) {
    const normalizedRequestStatus =
      session.role === 'host' && hostPendingIds.has(session.id)
        ? 'pending'
        : session.role === 'player' && playerPendingIds.has(session.id)
          ? 'pending'
          : session.request_status

    const normalized: MySession = {
      ...session,
      host_id: session.host_id ?? (session.role === 'host' ? userId : null) ?? hostIdBySessionId.get(session.id) ?? null,
      results_status: session.results_status ?? resultsStatusBySessionId.get(session.id) ?? null,
      user_result: userResultBySessionId.get(session.id) ?? null,
      has_rated: session.has_rated || ratedSessionIds.has(session.id),
      is_ranked: isRankedBySessionId.get(session.id) ?? true,
      request_status: normalizedRequestStatus,
    }

    const key = `${normalized.role}:${normalized.id}`
    const current = byKey.get(key)
    if (!current || (current.request_status !== 'pending' && normalized.request_status === 'pending')) {
      byKey.set(key, normalized)
    }
  }

  // Handle missing pending sessions
  const existingPlayerPendingIds = new Set(
    Array.from(byKey.values())
      .filter((session) => session.role === 'player' && session.request_status === 'pending')
      .map((session) => session.id),
  )
  const missingPlayerPendingIds = Array.from(playerPendingIds).filter((id) => !existingPlayerPendingIds.has(id))

  if (missingPlayerPendingIds.length > 0) {
    const { data: missingPendingSessions } = await supabase
      .from('sessions')
      .select(`
        id,
        status,
        results_status,
        host_id,
        is_ranked,
        court_booking_status,
        max_players,
        elo_min,
        elo_max,
        host:host_id(id, name),
        slot:slot_id(
          start_time,
          end_time,
          court:court_id(name, city, address)
        ),
        session_players(status)
      `)
      .in('id', missingPlayerPendingIds)

    for (const rawSession of missingPendingSessions ?? []) {
      const session: any = rawSession
      const slot = session?.slot
      const court = slot?.court
      const host = session?.host
      const players = Array.isArray(session?.session_players) ? session.session_players : []
      const playerCount = players.filter((p: any) => (p?.status ?? 'confirmed') !== 'rejected').length

      const normalized: MySession = {
        id: session.id,
        status: session.status ?? 'open',
        court_booking_status: session.court_booking_status ?? 'unconfirmed',
        host_id: session.host_id ?? host?.id ?? null,
        role: 'player',
        request_status: 'pending',
        results_status: session.results_status ?? null,
        start_time: slot?.start_time ?? new Date().toISOString(),
        end_time: slot?.end_time ?? slot?.start_time ?? new Date().toISOString(),
        court_name: court?.name ?? 'Kèo Pickleball',
        court_city: court?.city ?? '',
        court_address: court?.address ?? '',
        host_name: host?.name ?? 'Ẩn danh',
        player_count: playerCount,
        max_players: session.max_players ?? 0,
        elo_min: session.elo_min ?? null,
        elo_max: session.elo_max ?? null,
        has_rated: false,
        is_ranked: session.is_ranked ?? true,
      }

      byKey.set(`player:${normalized.id}`, normalized)
    }
  }

  const nextSessions: MySession[] = Array.from(byKey.values())
  nextSessions.sort((a, b) => {
    const aTime = new Date(a.start_time).getTime()
    const bTime = new Date(b.start_time).getTime()
    return (Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime) - (Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime)
  })

  return nextSessions
}
