import type {
  HostCheckInRequest,
  HostCheckoutRequest,
  HostRestRequest,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
} from './types'

export const DEFAULT_SCORING_WEIGHTS = {
  pvna: 1,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
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

function normalizeGender(value: unknown): 'M' | 'F' | null {
  const gender = String(value ?? '').trim().toLowerCase()
  if (gender === 'm' || gender === 'male' || gender === 'nam') return 'M'
  if (gender === 'f' || gender === 'female' || gender === 'nữ' || gender === 'nu') return 'F'
  return null
}

function normalizeGenderPreference(value: unknown): 'any' | 'M' | 'F' {
  const pref = String(value ?? '').trim().toLowerCase()
  if (pref === 'm' || pref === 'male' || pref === 'nam') return 'M'
  if (pref === 'f' || pref === 'female' || pref === 'nữ' || pref === 'nu') return 'F'
  return 'any'
}

function legacyEloToPvna(value: number): number {
  if (value <= 800) return 2.1
  if (value <= 1000) return 2.1 + (value - 800) * (0.5 / 200)
  if (value <= 1150) return 2.6 + (value - 1000) * (0.5 / 150)
  if (value <= 1300) return 3.1 + (value - 1150) * (0.5 / 150)
  if (value <= 1450) return 3.6 + (value - 1300) * (1 / 150)
  if (value <= 1600) return 4.6 + (value - 1450) * (0.9 / 150)
  return 5.5 + (value - 1600) * (0.1 / 200)
}

function normalizePvna(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric > 10 ? Number(legacyEloToPvna(numeric).toFixed(2)) : numeric
}

function getProfilePvna(profile: SessionPlayerStateRow['players'] | SessionPlayerPreferenceRow['players']): number {
  return normalizePvna(profile?.pvna) ?? normalizePvna(profile?.current_elo) ?? normalizePvna(profile?.elo) ?? 3.0
}

function getMetadataPref(
  metadata: Record<string, unknown> | null | undefined,
  key: 'partner_gender_pref' | 'opponent_gender_pref',
) {
  return metadata && Object.prototype.hasOwnProperty.call(metadata, key) ? metadata[key] : undefined
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
  preferenceRows?: SessionPlayerPreferenceRow[]
  courts?: number
  pvnaTolerance?: number
}): SessionState {
  const players = new Map<string, PlayerSessionState>()
  const preferencesByPlayerId = new Map(
    (input.preferenceRows ?? []).map((row) => [row.player_id, row]),
  )

  for (const row of input.playerRows) {
    const preferenceRow = preferencesByPlayerId.get(row.player_id)
    const metadata = row.session_players?.metadata ?? preferenceRow?.metadata
    const profile = preferenceRow?.players ?? row.players

    players.set(row.player_id, {
      player_id: row.player_id,
      pvna: getProfilePvna(profile),
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
      gender: normalizeGender(profile?.gender),
      partner_gender_pref: normalizeGenderPreference(
        getMetadataPref(metadata, 'partner_gender_pref') ?? profile?.partner_gender_pref,
      ),
      opponent_gender_pref: normalizeGenderPreference(
        getMetadataPref(metadata, 'opponent_gender_pref') ?? profile?.opponent_gender_pref,
      ),
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
      pvna_tolerance: input.pvnaTolerance ?? 0.5,
      weights: DEFAULT_SCORING_WEIGHTS,
    },
    players,
    rounds,
  }
}

export async function loadSessionState(
  supabase: LiveSessionSupabaseClient,
  sessionId: string,
  options: { courts?: number; pvnaTolerance?: number } = {},
): Promise<SessionState> {
  const [playersResult, pairsResult, roundsResult] = await Promise.all([
    supabase
      .from<SessionPlayerStateRow[]>('session_player_state')
      .select('*, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
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

  const playerIds = (playersResult.data ?? []).map((row) => row.player_id)
  let preferenceRows: SessionPlayerPreferenceRow[] = []

  if (playerIds.length > 0) {
    const preferenceResult = await supabase
      .from<SessionPlayerPreferenceRow[]>('session_players')
      .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('player_id', { ascending: true })

    if (preferenceResult.error) {
      throw new Error(preferenceResult.error.message)
    }

    preferenceRows = preferenceResult.data ?? []
  }

  return mapRowsToSessionState({
    sessionId,
    playerRows: playersResult.data ?? [],
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    preferenceRows,
    courts: options.courts,
    pvnaTolerance: options.pvnaTolerance,
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
