import type {
  AvoidPair,
  HostCheckInRequest,
  HostCheckoutRequest,
  HostPvnaOverrideRequest,
  HostRestRequest,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
} from './types.ts'

export const DEFAULT_SCORING_WEIGHTS = {
  pvna: 1,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 6,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
  consecutive_play: 4,
}

export type QueryResult<T> = {
  data: T | null
  error: { message: string } | null
}

export type LiveSessionSupabaseClient = {
  from: <T = unknown>(table: string) => any
}

type LoadSessionStateOptions = {
  courts?: number
  pvnaTolerance?: number
  traceLabel?: string
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

const FALLBACK_NEWBIE_PVNA = 2.1

function normalizePvna(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric <= 0) return null
  return numeric > 10 ? Number(legacyEloToPvna(numeric).toFixed(2)) : numeric
}

type PvnaSource = 'pvna' | 'current_elo' | 'elo' | 'fallback_newbie'

type PvnaResolution = {
  pvna: number
  source: PvnaSource
}

function resolveProfilePvna(
  profile: SessionPlayerStateRow['players'] | SessionPlayerPreferenceRow['players'],
): PvnaResolution {
  const fromPvna = normalizePvna(profile?.pvna)
  if (fromPvna !== null) return { pvna: fromPvna, source: 'pvna' }

  const fromCurrentElo = normalizePvna(profile?.current_elo)
  if (fromCurrentElo !== null) return { pvna: fromCurrentElo, source: 'current_elo' }

  const fromElo = normalizePvna(profile?.elo)
  if (fromElo !== null) return { pvna: fromElo, source: 'elo' }

  return { pvna: FALLBACK_NEWBIE_PVNA, source: 'fallback_newbie' }
}

function getMetadataPref(
  metadata: Record<string, unknown> | null | undefined,
  key: 'partner_gender_pref' | 'opponent_gender_pref',
) {
  return metadata && Object.prototype.hasOwnProperty.call(metadata, key) ? metadata[key] : undefined
}

type GenderPrefKey = 'partner_gender_pref' | 'opponent_gender_pref'
type GenderPrefSource =
  | 'session_player_state_metadata'
  | 'session_players_metadata'
  | 'profile'
  | 'default_any'

type GenderPrefResolution = {
  value: 'any' | 'M' | 'F'
  source: GenderPrefSource
  rawValue: unknown
}

function resolveGenderPreference(input: {
  metadata: Record<string, unknown> | null | undefined
  metadataSource: Exclude<GenderPrefSource, 'profile' | 'default_any'> | null
  profileValue: unknown
  key: GenderPrefKey
}): GenderPrefResolution {
  const metadataValue = getMetadataPref(input.metadata, input.key)
  if (metadataValue !== undefined && input.metadataSource) {
    return {
      value: normalizeGenderPreference(metadataValue),
      source: input.metadataSource,
      rawValue: metadataValue,
    }
  }

  if (input.profileValue !== null && input.profileValue !== undefined && input.profileValue !== '') {
    return {
      value: normalizeGenderPreference(input.profileValue),
      source: 'profile',
      rawValue: input.profileValue,
    }
  }

  return {
    value: 'any',
    source: 'default_any',
    rawValue: undefined,
  }
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
  extraConfig?: {
    planned_total_rounds?: number
    court_preset?: 'balanced' | 'play_more' | 'relaxed'
    avoid_pairs?: AvoidPair[]
    current_courts?: number
  }
}): SessionState {
  const players = new Map<string, PlayerSessionState>()
  const preferencesByPlayerId = new Map(
    (input.preferenceRows ?? []).map((row) => [row.player_id, row]),
  )
  const pvnaFallbackWarnings: Array<{
    player_id: string
    selected_profile_source: 'session_players' | 'session_player_state' | 'none'
    preference_profile: SessionPlayerPreferenceRow['players'] | null | undefined
    state_profile: SessionPlayerStateRow['players'] | null | undefined
    state_profile_has_rating: boolean
  }> = []
  const metadataPreferenceOverrideWarnings: Array<{
    player_id: string
    key: GenderPrefKey
    source: Exclude<GenderPrefSource, 'profile' | 'default_any'>
    metadata_value: unknown
    profile_value: unknown
    normalized_metadata_value: 'any' | 'M' | 'F'
    normalized_profile_value: 'any' | 'M' | 'F'
  }> = []

  for (const row of input.playerRows) {
    const preferenceRow = preferencesByPlayerId.get(row.player_id)
    const metadata = row.session_players?.metadata ?? preferenceRow?.metadata
    const metadataSource = row.session_players?.metadata
      ? 'session_player_state_metadata' as const
      : preferenceRow?.metadata
        ? 'session_players_metadata' as const
        : null
    const profile = preferenceRow?.players ?? row.players
    const pvnaResolution = resolveProfilePvna(profile)
    if (pvnaResolution.source === 'fallback_newbie') {
      pvnaFallbackWarnings.push({
        player_id: row.player_id,
        selected_profile_source: preferenceRow?.players ? 'session_players' : row.players ? 'session_player_state' : 'none',
        preference_profile: preferenceRow?.players,
        state_profile: row.players,
        state_profile_has_rating: row.players ? resolveProfilePvna(row.players).source !== 'fallback_newbie' : false,
      })
    }
    const partnerGenderPref = resolveGenderPreference({
      metadata,
      metadataSource,
      profileValue: profile?.partner_gender_pref,
      key: 'partner_gender_pref',
    })
    const opponentGenderPref = resolveGenderPreference({
      metadata,
      metadataSource,
      profileValue: profile?.opponent_gender_pref,
      key: 'opponent_gender_pref',
    })
    for (const [key, resolution, profileValue] of [
      ['partner_gender_pref', partnerGenderPref, profile?.partner_gender_pref],
      ['opponent_gender_pref', opponentGenderPref, profile?.opponent_gender_pref],
    ] as const) {
      if (resolution.source === 'profile' || resolution.source === 'default_any') continue
      const normalizedProfileValue = normalizeGenderPreference(profileValue)
      if (normalizedProfileValue === 'any' || normalizedProfileValue === resolution.value) continue
      metadataPreferenceOverrideWarnings.push({
        player_id: row.player_id,
        key,
        source: resolution.source,
        metadata_value: resolution.rawValue,
        profile_value: profileValue,
        normalized_metadata_value: resolution.value,
        normalized_profile_value: normalizedProfileValue,
      })
    }

    players.set(row.player_id, {
      player_id: row.player_id,
      pvna: pvnaResolution.pvna,
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
      partner_gender_pref: partnerGenderPref.value,
      opponent_gender_pref: opponentGenderPref.value,
      rounds_available: 0,
      effective_pvna: row.effective_pvna ?? undefined,
      last_rest_started_round: row.consecutive_rest > 0 ? row.last_played_round + 1 : undefined,
    })
  }

  if (pvnaFallbackWarnings.length > 0) {
    console.warn('[next-round-suggester] missing player PVNA; using newbie fallback', {
      sessionId: input.sessionId,
      fallbackPvna: FALLBACK_NEWBIE_PVNA,
      count: pvnaFallbackWarnings.length,
      players: pvnaFallbackWarnings,
    })
  }
  if (metadataPreferenceOverrideWarnings.length > 0) {
    console.warn('[next-round-suggester] session metadata gender preference overrides profile preference', {
      sessionId: input.sessionId,
      count: metadataPreferenceOverrideWarnings.length,
      overrides: metadataPreferenceOverrideWarnings,
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

  // Thay đổi B: tính rounds_available từ completed round history
  const playerRoundsAvailable = new Map<string, number>()
  for (const round of rounds) {
    if (round.status !== 'completed') continue
    const presentIds = new Set([
      ...round.matches.flatMap(m => [...m.team_a, ...m.team_b]),
      ...(round.resting ?? []),
    ])
    for (const id of presentIds) {
      playerRoundsAvailable.set(id, (playerRoundsAvailable.get(id) ?? 0) + 1)
    }
  }
  for (const [id, player] of players) {
    player.rounds_available = playerRoundsAvailable.get(id) ?? 0
  }

  // Thay đổi C: build avoid_ids per player từ extraConfig.avoid_pairs
  const avoidPairs = input.extraConfig?.avoid_pairs ?? []
  for (const [id, player] of players) {
    player.avoid_ids = new Set(
      avoidPairs
        .filter(p => p.player_a === id || p.player_b === id)
        .map(p => (p.player_a === id ? p.player_b : p.player_a)),
    )
  }

  return {
    session_id: input.sessionId,
    current_round: currentRound,
    status: rounds.some((round) => round.status === 'active') ? 'active' : 'waiting',
    config: {
      courts: input.extraConfig?.current_courts ?? input.courts ?? 1,
      pvna_tolerance: input.pvnaTolerance ?? 0.5,
      weights: DEFAULT_SCORING_WEIGHTS,
      planned_total_rounds: input.extraConfig?.planned_total_rounds,
      court_preset: input.extraConfig?.court_preset,
      avoid_pairs: avoidPairs.length > 0 ? avoidPairs : undefined,
    },
    players,
    rounds,
  }
}

export async function loadSessionState(
  supabase: LiveSessionSupabaseClient,
  sessionId: string,
  options: LoadSessionStateOptions = {},
): Promise<SessionState> {
  const startedAt = Date.now()
  async function timedQuery<T>(query: Promise<QueryResult<T>>): Promise<QueryResult<T> & { elapsedMs: number }> {
    const queryStartedAt = Date.now()
    const result = await query
    return {
      ...result,
      elapsedMs: Date.now() - queryStartedAt,
    }
  }

  const [playersResult, pairsResult, roundsResult, preferenceResult] = await Promise.all([
    timedQuery<SessionPlayerStateRow[]>(
      supabase
        .from<SessionPlayerStateRow[]>('session_player_state')
        .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
        .eq('session_id', sessionId)
        .order('checked_in_at', { ascending: true }),
    ),
    timedQuery<SessionPairHistoryRow[]>(
      supabase
        .from<SessionPairHistoryRow[]>('session_pair_history')
        .select('session_id, player_a, player_b, partner_count, opponent_count')
        .eq('session_id', sessionId)
        .order('player_a', { ascending: true }),
    ),
    timedQuery<SessionRoundRow[]>(
      supabase
        .from<SessionRoundRow[]>('session_rounds')
        .select('id, session_id, round_no, status, matches, resting, started_at, ended_at')
        .eq('session_id', sessionId)
        .order('round_no', { ascending: true }),
    ),
    timedQuery<SessionPlayerPreferenceRow[]>(
      supabase
        .from<SessionPlayerPreferenceRow[]>('session_players')
        .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
        .eq('session_id', sessionId)
        .order('player_id', { ascending: true }),
    ),
  ])

  const error = playersResult.error ?? pairsResult.error ?? roundsResult.error ?? preferenceResult.error
  if (error) {
    throw new Error(error.message)
  }

  const preferenceRows: SessionPlayerPreferenceRow[] = preferenceResult.data ?? []
  const mapStartedAt = Date.now()
  const state = mapRowsToSessionState({
    sessionId,
    playerRows: playersResult.data ?? [],
    pairRows: pairsResult.data ?? [],
    roundRows: roundsResult.data ?? [],
    preferenceRows,
    courts: options.courts,
    pvnaTolerance: options.pvnaTolerance,
  })

  if (options.traceLabel) {
    console.log(`[${options.traceLabel}] loadSessionState detail`, {
      playersQuery: playersResult.elapsedMs,
      pairsQuery: pairsResult.elapsedMs,
      roundsQuery: roundsResult.elapsedMs,
      preferencesQuery: preferenceResult.elapsedMs,
      mapRows: Date.now() - mapStartedAt,
      total: Date.now() - startedAt,
      players: playersResult.data?.length ?? 0,
      pairs: pairsResult.data?.length ?? 0,
      rounds: roundsResult.data?.length ?? 0,
      preferences: preferenceRows.length,
    })
  }

  return state
}

export function getEffectivePvna(player: PlayerSessionState): number {
  return player.effective_pvna ?? player.pvna
}

export function getBenchDepth(state: SessionState): number {
  const active = [...state.players.values()].filter(
    p => p.checked_out_at === null && !p.opted_rest,
  ).length
  return Math.max(0, active - state.config.courts * 4)
}

export function getSessionPhase(
  state: SessionState,
  completedRounds: number,
): 'warmup' | 'mid' | 'closing' {
  if (completedRounds < 3) return 'warmup'
  const planned = state.config.planned_total_rounds
  if (planned != null && planned - completedRounds <= 2) return 'closing'
  return 'mid'
}

export function buildPvnaOverridePatch(
  request: HostPvnaOverrideRequest,
): Pick<SessionPlayerStateRow, 'player_id' | 'effective_pvna'> {
  return {
    player_id: request.player_id,
    effective_pvna: request.effective_pvna,
  }
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
  const patch: { player_id: string; opted_rest: boolean; consecutive_rest?: number } = {
    player_id: request.player_id,
    opted_rest: request.opted_rest,
  }
  if (request.opted_rest === false && request.reason === 'voluntary') {
    patch.consecutive_rest = 0
  }
  return patch
}

export function getActiveGroupId(
  player: PlayerSessionState,
  state: SessionState,
): string | null {
  if (!player.group_id) return null
  const hasActiveGroupMember = [...state.players.values()].some(
    (p) =>
      p.player_id !== player.player_id &&
      p.group_id === player.group_id &&
      p.checked_out_at === null,
  )
  return hasActiveGroupMember ? player.group_id : null
}
