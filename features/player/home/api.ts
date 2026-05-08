import { supabase } from '@/lib/supabase'
import {
    normalizeHomeSessionRecord,
    type FamiliarCourt,
    type HomeProfile,
    type HomeSessionRecordRaw,
    type MatchSession,
    type PendingMatch,
    type PlayerStatsRecord,
    type PostMatchAction,
    isWithinNext24Hours,
    normalizeRelation,
    formatPendingResultTimeLabel,
    mapLiveSessionToMatchSession,
    buildLiveFamiliarCourts,
    isWithinNext12Hours
} from '@/lib/homeFeed'

export type HomeData = {
  profile: HomeProfile | null
  playerStats: PlayerStatsRecord | null
  nextMatch: MatchSession | null
  pendingMatches: PendingMatch[]
  postMatchActions: PostMatchAction[]
  personalizedSessions: MatchSession[]
  rescueSessions: MatchSession[]
  familiarCourts: FamiliarCourt[]
}

export async function fetchHomeDataApi(userId: string | null): Promise<HomeData> {
  const { data, error } = await supabase.rpc('get_home_data', { p_user_id: userId })

  if (error) {
    console.error('Error fetching home data via RPC:', error)
    throw error
  }

  const homeData = data as {
    profile: HomeProfile | null
    stats: PlayerStatsRecord | null
    pending_matches: any[]
    post_match_actions: any[]
    open_sessions: HomeSessionRecordRaw[]
    upcoming_sessions: HomeSessionRecordRaw[]
    favorite_courts: any[]
    server_time: string
  }

  const nextProfile = homeData.profile
  const nextPlayerStats = homeData.stats
  const viewerElo = nextProfile?.current_elo ?? nextProfile?.elo ?? null
  const favoriteCourtIds = nextProfile?.favorite_court_ids?.filter(Boolean) ?? []

  const openSessionsRaw = (homeData.open_sessions ?? []).map(normalizeHomeSessionRecord)
  const upcomingSessionsRaw = (homeData.upcoming_sessions ?? []).map(normalizeHomeSessionRecord)
  
  const allSessions = [...openSessionsRaw, ...upcomingSessionsRaw]
  
  // 1. My Upcoming Sessions (for Hero card)
  const sortedMyUpcoming = [...upcomingSessionsRaw]
    .filter(s => isWithinNext24Hours(s.slot?.start_time ?? ''))
    .sort((left, right) => Date.parse(left.slot?.start_time ?? '') - Date.parse(right.slot?.start_time ?? ''))

  const liveNextSession = sortedMyUpcoming[0] ?? null

  // 2. Pending Matches (Host tasks)
  const nextPendingMatches = (homeData.pending_matches ?? [])
    .map((item) => {
      const slot = normalizeRelation(item.slot)
      const court = normalizeRelation(slot?.court ?? null)
      const startTime = slot?.start_time ?? ''
      const endTime = slot?.end_time ?? ''
      
      const confirmedCount = (item.session_players ?? []).filter((p: any) => p.status === 'confirmed').length
      const isEven = confirmedCount % 2 === 0
      const isValid = confirmedCount >= 2 && isEven && confirmedCount <= (item.max_players ?? 4)

      return {
        id: item.id,
        courtName: court?.name ?? 'Kèo Pickleball',
        timeLabel: formatPendingResultTimeLabel(endTime),
        startTime,
        endTime,
        resultsStatus: item.results_status,
        isValidCount: isValid,
      }
    })
    .filter((item) => item.isValidCount)
    .sort((left, right) => Date.parse(right.endTime) - Date.parse(left.endTime))

  // 3. Post Match Actions (Player tasks)
  const nextPostMatchActions = (homeData.post_match_actions ?? [])
    .reduce<PostMatchAction[]>((acc, row) => {
      const session = normalizeRelation(row.session ?? null)
      const slot = normalizeRelation(session?.slot ?? null)
      const court = normalizeRelation(slot?.court ?? null)
      const startTime = slot?.start_time ?? ''
      const endTime = slot?.end_time ?? ''

      if (!session) return acc

      // If results are pending confirmation, show "confirm" task first
      if (session.results_status === 'pending_confirmation' || session.results_status === 'disputed') {
        if (row.result_confirmation_status === 'confirmed' || row.result_confirmation_status === 'disputed') {
          // If already confirmed result, show "report" (rating) task
          acc.push({
            id: session.id,
            courtName: court?.name ?? 'Kèo Pickleball',
            timeLabel: formatPendingResultTimeLabel(endTime),
            startTime,
            endTime,
            actionType: 'report' as const,
            resultsStatus: session.results_status,
          })
          return acc
        }

        acc.push({
          id: session.id,
          courtName: court?.name ?? 'Kèo Pickleball',
          timeLabel: formatPendingResultTimeLabel(endTime),
          startTime,
          endTime,
          actionType: 'confirm' as const,
          resultsStatus: session.results_status,
        })
        return acc
      }

      // Default to report for finalized sessions
      acc.push({
        id: session.id,
        courtName: court?.name ?? 'Kèo Pickleball',
        timeLabel: formatPendingResultTimeLabel(endTime),
        startTime,
        endTime,
        actionType: 'report' as const,
        resultsStatus: session.results_status || 'not_submitted',
      })

      return acc
    }, [])
    .slice(0, 4)

  return {
    profile: nextProfile,
    playerStats: nextPlayerStats,
    pendingMatches: nextPendingMatches,
    postMatchActions: nextPostMatchActions,
    familiarCourts: buildLiveFamiliarCourts(allSessions, {
      favoriteCourtIds,
      favoriteCourtsMeta: homeData.favorite_courts ?? [],
      courtsRaw: [], // buildLiveFamiliarCourts will use favoriteCourtsMeta if provided
    }),
    nextMatch: liveNextSession
      ? mapLiveSessionToMatchSession(liveNextSession, {
          viewerId: userId,
          viewerElo,
          hostAverageRating: nextPlayerStats?.host_average_rating,
        })
      : null,
    personalizedSessions: openSessionsRaw
      .filter((session) => session.id !== liveNextSession?.id)
      .map((session) => mapLiveSessionToMatchSession(session, { viewerId: userId, viewerElo }))
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 5)
      .map((session, index, sessions) => ({
        ...session,
        carouselIndex: index,
        carouselTotal: sessions.length,
      })),
    rescueSessions: openSessionsRaw
      .filter((session) => {
        const confirmedPlayers = session.session_players.filter((player) => player.status === 'confirmed').length
        const slotsLeft = Math.max(session.max_players - confirmedPlayers, 0)
        return slotsLeft > 0 && slotsLeft <= 2 && isWithinNext12Hours(session.slot?.start_time ?? '')
      })
      .map((session) => mapLiveSessionToMatchSession(session, { viewerId: userId, viewerElo, urgent: true }))
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 5),
  }
}

