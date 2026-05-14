import type {
  HostCheckInRequest,
  HostCheckoutRequest,
  HostRestRequest,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
} from './types'

export const DEFAULT_SCORING_WEIGHTS = {
  elo: 1,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
}

export type QueryResult<T> = {
  data: T | null
  error: { message: string } | null
}

type SupabaseQuery<T> = {
  select: (columns: string) => SupabaseQuery<T>
  eq: (column: string, value: string | number | boolean | null) => SupabaseQuery<T>
  order: (column: string, options?: { ascending?: boolean }) => Promise<QueryResult<T>>
}

export type LiveSessionSupabaseClient = {
  from: <T = unknown>(table: string) => SupabaseQuery<T>
}

export function normalizePairKey(playerA: string, playerB: string): [string, string] {
  if (playerA === playerB) {
    throw new Error('Pair must contain two different players')
  }

  return playerA < playerB ? [playerA, playerB] : [playerB, playerA]
}

export function deriveGroupId(sessionId: string, playerIds: string[]): string {
  const normalized = [...new Set(playerIds)].sort().join(':')
  return `${sessionId}:${normalized}`
}

export function isPresent(player: Pick<PlayerSessionState, 'checked_out_at'>): boolean {
  return player.checked_out_at === null
}

export function mapRowsToSessionState(input: {
  sessionId: string
  playerRows: SessionPlayerStateRow[]
  pairRows: SessionPairHistoryRow[]
  roundRows: SessionRoundRow[]
  courts?: number
  eloTolerance?: number
}): SessionState {
  const players = new Map<string, PlayerSessionState>()

  for (const row of input.playerRows) {
    players.set(row.player_id, {
      player_id: row.player_id,
      elo: row.players?.elo ?? 1000,
      group_id: row.group_id,
      checked_in_at: new Date(row.checked_in_at),
      checked_out_at: row.checked_out_at ? new Date(row.checked_out_at) : null,
      matches_played: row.matches_played,
      last_played_round: row.last_played_round,
      consecutive_rest: row.consecutive_rest,
      consecutive_play: row.consecutive_play,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: row.opted_rest,
    })
  }

  for (const row of input.pairRows) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)

    if (playerA) {
      playerA.partner_counts.set(row.player_b, row.partner_count)
      playerA.opponent_counts.set(row.player_b, row.opponent_count)
    }

    if (playerB) {
      playerB.partner_counts.set(row.player_a, row.partner_count)
      playerB.opponent_counts.set(row.player_a, row.opponent_count)
    }
  }

  const rounds: RoundRecord[] = input.roundRows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    round_no: row.round_no,
    status: row.status,
    matches: row.matches,
    resting: row.resting,
    started_at: row.started_at ? new Date(row.started_at) : null,
    ended_at: row.ended_at ? new Date(row.ended_at) : null,
  }))

  const currentRound = rounds.reduce((max, round) => Math.max(max, round.round_no), -1) + 1

  return {
    session_id: input.sessionId,
    current_round: currentRound,
    status: rounds.some((round) => round.status === 'active') ? 'active' : 'waiting',
    config: {
      courts: input.courts ?? 1,
      elo_tolerance: input.eloTolerance ?? 150,
      weights: DEFAULT_SCORING_WEIGHTS,
    },
    players,
    rounds,
  }
}

export async function loadSessionState(
  supabase: LiveSessionSupabaseClient,
  sessionId: string,
  options: { courts?: number; eloTolerance?: number } = {},
): Promise<SessionState> {
  const [playersResult, pairsResult, roundsResult] = await Promise.all([
    supabase
      .from<SessionPlayerStateRow[]>('session_player_state')
      .select('*, players(elo)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    supabase
      .from<SessionPairHistoryRow[]>('session_pair_history')
      .select('*')
      .eq('session_id', sessionId)
      .order('player_a', { ascending: true }),
    supabase
      .from<SessionRoundRow[]>('session_rounds')
      .select('*')
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true }),
  ])

  const error = playersResult.error ?? pairsResult.error ?? roundsResult.error
  if (error) {
    throw new Error(error.message)
  }

  return mapRowsToSessionState({
    sessionId,
    playerRows: playersResult.data ?? [],
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    courts: options.courts,
    eloTolerance: options.eloTolerance,
  })
}

export function buildCheckInPatch(
  sessionId: string,
  request: HostCheckInRequest,
  now: Date,
): SessionPlayerStateRow {
  const groupMembers = [request.player_id, ...(request.group_with ?? [])]
  const groupId = groupMembers.length > 1 ? deriveGroupId(sessionId, groupMembers) : null

  return {
    session_id: sessionId,
    player_id: request.player_id,
    group_id: groupId,
    checked_in_at: now.toISOString(),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
  }
}

export function buildCheckoutPatch(request: HostCheckoutRequest, now: Date) {
  return {
    player_id: request.player_id,
    checked_out_at: now.toISOString(),
    opted_rest: false,
  }
}

export function buildRestPatch(request: HostRestRequest) {
  return {
    player_id: request.player_id,
    opted_rest: request.opted_rest,
  }
}
