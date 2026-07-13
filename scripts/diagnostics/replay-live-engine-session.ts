/**
 * Replay captured live-suggestion requests through the real engine.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/replay-live-engine-session.ts <dump_slices.json>
 *
 * The input is produced by tmp/pull-dump-slices.ts. This is a request-level
 * counterfactual: every policy sees the same player snapshot, history, live
 * locks, fairness adjustment, and court request that production saw.
 */
import { readFileSync } from 'node:fs'
import {
  buildSuggestedMatchPayloads,
  type CourtSelectionDebug,
  type LiveQualityPolicy,
  type SuggestedMatchPayload,
} from '../../lib/next-round-suggester/live-preview.ts'
import { DEFAULT_SCORING_WEIGHTS } from '../../lib/next-round-suggester/state.ts'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionLiveMatchRow,
  SessionState,
  Team,
} from '../../lib/next-round-suggester/types.ts'

type JsonRecord = Record<string, any>

type ReplayMetrics = {
  boards: number
  teamGap: number
  maxTeamGap: number
  intraGap: number
  maxIntraGap: number
  partnerRepeats: number
  opponentRepeats: number
  selectedMaxMatches: number
}

type ReplayResult = {
  policy: LiveQualityPolicy
  payloads: SuggestedMatchPayload[]
  debug: CourtSelectionDebug[]
  metrics: ReplayMetrics
  runtimeMs: number
  invariantErrors: string[]
}

const POLICIES: LiveQualityPolicy[] = [
  'current',
  'intra_guard',
  'pvna_outlier_rescue',
  'balanced_late_quality',
  'recent_overlap_guarded',
]

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function date(value: unknown): Date | null {
  if (!value) return null
  const parsed = new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function toPlayer(raw: JsonRecord, capturedAt: string): PlayerSessionState {
  return {
    player_id: String(raw.id),
    pvna: number(raw.pvna, 2.1),
    effective_pvna: raw.effective_pvna == null ? undefined : number(raw.effective_pvna),
    group_id: raw.group_id ?? null,
    checked_in_at: date(raw.checked_in_at) ?? new Date(capturedAt),
    checked_out_at: raw.checked_out ? (date(raw.checked_out_at) ?? new Date(capturedAt)) : null,
    matches_played: number(raw.matches_played),
    last_played_round: number(raw.last_played_round, -1),
    consecutive_rest: number(raw.consecutive_rest),
    consecutive_play: number(raw.consecutive_play),
    partner_counts: new Map(Object.entries(raw.partner_counts ?? {}).map(([id, count]) => [id, number(count)])),
    opponent_counts: new Map(Object.entries(raw.opponent_counts ?? {}).map(([id, count]) => [id, number(count)])),
    opted_rest: Boolean(raw.opted_rest),
    gender: raw.gender === 'M' || raw.gender === 'F' ? raw.gender : null,
    partner_gender_pref: raw.partner_gender_pref === 'M' || raw.partner_gender_pref === 'F'
      ? raw.partner_gender_pref
      : 'any',
    opponent_gender_pref: raw.opponent_gender_pref === 'M' || raw.opponent_gender_pref === 'F'
      ? raw.opponent_gender_pref
      : 'any',
    rounds_available: number(raw.rounds_available),
  }
}

function toRound(raw: JsonRecord, sessionId: string): RoundRecord {
  return {
    id: raw.id,
    session_id: raw.session_id ?? sessionId,
    round_no: number(raw.round_no),
    status: raw.status === 'active' || raw.status === 'proposed' ? raw.status : 'completed',
    matches: (raw.matches ?? []).map((match: JsonRecord, courtIdx: number): Match => ({
      court_idx: number(match.court_idx, courtIdx),
      team_a: match.team_a as Team,
      team_b: match.team_b as Team,
    })),
    resting: raw.resting ?? [],
    started_at: date(raw.started_at),
    ended_at: date(raw.ended_at),
  }
}

function toLiveRow(raw: JsonRecord, sessionId: string, capturedAt: string): SessionLiveMatchRow {
  return {
    id: String(raw.id),
    session_id: sessionId,
    sequence_no: number(raw.sequence_no),
    round_no: raw.round_no == null ? null : number(raw.round_no),
    cycle_no: raw.cycle_no == null ? null : number(raw.cycle_no),
    court_idx: raw.court_idx == null ? null : number(raw.court_idx),
    status: raw.status,
    team_a: raw.team_a as Team,
    team_b: raw.team_b as Team,
    resting: raw.resting ?? [],
    score_a: number(raw.score_a),
    score_b: number(raw.score_b),
    suggested_at: raw.suggested_at ?? capturedAt,
    started_at: raw.started_at ?? null,
    ended_at: raw.ended_at ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    suggestion_metadata: raw.suggestion_metadata ?? null,
  }
}

function buildState(row: JsonRecord): SessionState {
  const request = row.request_v2 ?? {}
  const state = row.state ?? {}
  const config = state.config ?? {}
  const sessionId = state.session_id ?? row.session_id ?? 'replay-session'
  const players = new Map<string, PlayerSessionState>()
  for (const raw of row.players ?? []) {
    const player = toPlayer(raw, row.created_at)
    players.set(player.player_id, player)
  }
  return {
    session_id: sessionId,
    current_round: number(state.current_round),
    status: state.status === 'waiting' || state.status === 'paused' || state.status === 'ended'
      ? state.status
      : 'active',
    config: {
      courts: number(config.courts ?? request.court_count, 1),
      pvna_tolerance: number(config.pvna_tolerance ?? request.pvna_tolerance, 0.5),
      planned_total_rounds: config.planned_total_rounds ?? request.planned_total_rounds,
      court_preset: config.court_preset ?? request.court_preset,
      avoid_pairs: config.avoid_pairs ?? request.avoid_pairs ?? [],
      weights: { ...DEFAULT_SCORING_WEIGHTS, ...(config.weights ?? {}) },
    },
    players,
    rounds: (row.round_records ?? []).map((round: JsonRecord) => toRound(round, sessionId)),
  }
}

function effectivePvna(state: SessionState, id: string): number {
  const player = state.players.get(id)
  return player?.effective_pvna ?? player?.pvna ?? 0
}

function pairCount(state: SessionState, a: string, b: string, kind: 'partner' | 'opponent'): number {
  const field = kind === 'partner' ? 'partner_counts' : 'opponent_counts'
  return Math.max(state.players.get(a)?.[field].get(b) ?? 0, state.players.get(b)?.[field].get(a) ?? 0)
}

function measure(payloads: SuggestedMatchPayload[], state: SessionState): ReplayMetrics {
  let teamGap = 0
  let maxTeamGap = 0
  let intraGap = 0
  let maxIntraGap = 0
  let partnerRepeats = 0
  let opponentRepeats = 0
  let selectedMaxMatches = 0
  for (const payload of payloads) {
    const [a1, a2] = payload.team_a
    const [b1, b2] = payload.team_b
    const gap = Math.abs(effectivePvna(state, a1) + effectivePvna(state, a2) - effectivePvna(state, b1) - effectivePvna(state, b2))
    const intra = Math.max(
      Math.abs(effectivePvna(state, a1) - effectivePvna(state, a2)),
      Math.abs(effectivePvna(state, b1) - effectivePvna(state, b2)),
    )
    teamGap += gap
    intraGap += intra
    maxTeamGap = Math.max(maxTeamGap, gap)
    maxIntraGap = Math.max(maxIntraGap, intra)
    partnerRepeats += pairCount(state, a1, a2, 'partner') + pairCount(state, b1, b2, 'partner')
    for (const a of payload.team_a) for (const b of payload.team_b) {
      opponentRepeats += pairCount(state, a, b, 'opponent')
    }
    for (const id of [...payload.team_a, ...payload.team_b]) {
      selectedMaxMatches = Math.max(selectedMaxMatches, state.players.get(id)?.matches_played ?? 0)
    }
  }
  return { boards: payloads.length, teamGap, maxTeamGap, intraGap, maxIntraGap, partnerRepeats, opponentRepeats, selectedMaxMatches }
}

function invariantErrors(
  payloads: SuggestedMatchPayload[],
  liveRows: SessionLiveMatchRow[],
  completingIds: Set<string>,
): string[] {
  const errors: string[] = []
  const selected = payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])
  if (new Set(selected).size !== selected.length) errors.push('duplicate_player_across_payloads')
  if (payloads.some(payload => payload.team_a.length !== 2 || payload.team_b.length !== 2)) errors.push('invalid_team_size')
  const busy = new Set(liveRows
    .filter(row => row.status === 'suggested' || (row.status === 'live' && !completingIds.has(row.id)))
    .flatMap(row => [...row.team_a, ...row.team_b]))
  if (selected.some(id => busy.has(id))) errors.push('selected_busy_player')
  return errors
}

function replay(row: JsonRecord, policy: LiveQualityPolicy): ReplayResult {
  const request = row.request_v2
  const state = buildState(row)
  const liveRows = (row.live_rows ?? []).map((liveRow: JsonRecord) => toLiveRow(liveRow, state.session_id, row.created_at))
  const completingIds = new Set<string>(request.completing_live_match_ids ?? [])
  const debug: CourtSelectionDebug[] = []
  const started = performance.now()
  const originalLog = console.log
  const originalWarn = console.warn
  console.log = () => undefined
  console.warn = () => undefined
  let payloads: SuggestedMatchPayload[]
  try {
    payloads = buildSuggestedMatchPayloads({
      count: number(request.count ?? request.requested_count, 1),
      sessionId: state.session_id,
      courtCount: number(request.court_count, state.config.courts),
      state,
      rows: { liveMatchRows: liveRows, liveStateVersion: request.live_state_version },
      completingLiveMatchIds: completingIds,
      fairnessAdjustment: row.fairness?.adjustment ?? {
        config_changes: {}, tier_overrides: {}, applied_for_warnings: [],
      },
      fairnessWarnings: row.fairness?.warnings ?? [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id.slice(0, 8) }])),
      pvnaTolerance: number(request.pvna_tolerance, state.config.pvna_tolerance),
      options: {
        courtIdxs: request.court_idxs?.length ? request.court_idxs : undefined,
        ignoreCapacityLock: !request.prefer_available_pool,
        deferExtremeTightPool: false,
        liveQualityPolicy: policy,
        nowMs: Date.parse(row.created_at),
      },
      debugOut: debug,
    })
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
  const runtimeMs = performance.now() - started
  return {
    policy,
    payloads,
    debug,
    metrics: measure(payloads, state),
    runtimeMs,
    invariantErrors: invariantErrors(payloads, liveRows, completingIds),
  }
}

function canonicalMatch(match: { court_idx: number | null; team_a: string[]; team_b: string[] }): string {
  const teams = [match.team_a.slice().sort().join(','), match.team_b.slice().sort().join(',')].sort()
  return `${match.court_idx}:${teams.join('|')}`
}

function matchesHistorical(row: JsonRecord, result: ReplayResult): boolean {
  const historical = (row.chosen_matches ?? [])
    .filter((match: JsonRecord) => !match.is_replacement)
    .map(canonicalMatch)
    .sort()
  const replayed = result.payloads.map(canonicalMatch).sort()
  return historical.length === replayed.length && historical.every((value: string, index: number) => value === replayed[index])
}

function fingerprint(row: JsonRecord): string {
  const request = row.request_v2 ?? {}
  return JSON.stringify({
    version: request.live_state_version,
    mode: request.mode,
    count: request.count,
    courts: request.court_idxs ?? [],
    completing: [...(request.completing_live_match_ids ?? [])].sort(),
    round: row.state?.current_round,
  })
}

function safeQualityWin(candidate: ReplayResult, baseline: ReplayResult): boolean {
  const a = candidate.metrics
  const b = baseline.metrics
  if (candidate.invariantErrors.length > 0 || a.boards !== b.boards) return false
  if (a.partnerRepeats > b.partnerRepeats || a.opponentRepeats > b.opponentRepeats) return false
  if (a.selectedMaxMatches > b.selectedMaxMatches) return false
  const baselineCost = b.teamGap * 10 + b.intraGap * 8
  const candidateCost = a.teamGap * 10 + a.intraGap * 8
  return candidateCost + 0.1 < baselineCost
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: npx tsx scripts/diagnostics/replay-live-engine-session.ts <dump_slices.json>')
  const args = process.argv.slice(3)
  const dumpId = args.find(arg => !arg.startsWith('--'))
  const waitSeconds = number(args.find(arg => arg.startsWith('--wait-seconds='))?.split('=')[1])
  const liveMatchesPath = args.find(arg => arg.startsWith('--live-matches='))?.split('=')[1]
  const raw = JSON.parse(readFileSync(path, 'utf8')) as JsonRecord[]
  const seen = new Set<string>()
  const rows = raw.filter(row => {
    if (dumpId && row.id !== dumpId) return false
    if (!row.request_v2 || !Array.isArray(row.players) || row.players.length < 4) return false
    const key = fingerprint(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const results = new Map<LiveQualityPolicy, ReplayResult[]>()
  const safeWins = new Map<LiveQualityPolicy, number>()
  for (const policy of POLICIES) results.set(policy, [])

  if (waitSeconds > 0 && liveMatchesPath) {
    const finalLiveRows = JSON.parse(readFileSync(liveMatchesPath, 'utf8')) as JsonRecord[]
    const finalById = new Map(finalLiveRows.map(row => [row.id, row]))
    const cases: Array<{
      row: JsonRecord
      baseline: ReplayResult
      waited: ReplayResult
      released: JsonRecord[]
    }> = []
    for (const row of rows) {
      const baseline = replay(row, 'current')
      const eligible = Math.max(0, ...baseline.debug.map(debug => debug.eligible_players.length))
      if (eligible < 4 || eligible > 7) continue
      if (baseline.metrics.maxTeamGap <= 1.25 && baseline.metrics.maxIntraGap <= 2) continue
      const capturedAtMs = Date.parse(row.created_at)
      const released = (row.live_rows ?? [])
        .filter((liveRow: JsonRecord) => liveRow.status === 'live')
        .map((liveRow: JsonRecord) => finalById.get(liveRow.id))
        .filter((liveRow): liveRow is JsonRecord => Boolean(liveRow?.ended_at))
        .filter(liveRow => {
          const endedAtMs = Date.parse(liveRow.ended_at)
          return endedAtMs > capturedAtMs && endedAtMs <= capturedAtMs + waitSeconds * 1_000
        })
      if (released.length === 0) continue
      const waitedRow = structuredClone(row)
      waitedRow.request_v2.completing_live_match_ids = [...new Set([
        ...(waitedRow.request_v2.completing_live_match_ids ?? []),
        ...released.map(liveRow => liveRow.id),
      ])]
      const waited = replay(waitedRow, 'current')
      cases.push({ row, baseline, waited, released })
    }
    console.log('BOUNDED-WAIT COUNTERFACTUAL')
    console.log(`wait_seconds=${waitSeconds} eligible_pool=4..7 extreme_cases_with_release=${cases.length}`)
    console.log(`safe_improvements=${cases.filter(item => safeQualityWin(item.waited, item.baseline)).length}`)
    for (const item of cases) {
      const capturedAtMs = Date.parse(item.row.created_at)
      const releaseMs = Math.min(...item.released.map(row => Date.parse(row.ended_at) - capturedAtMs))
      console.log([
        `dump=${item.row.id}`,
        `round=${item.row.state?.current_round}`,
        `eligible=${Math.max(0, ...item.baseline.debug.map(debug => debug.eligible_players.length))}`,
        `release_after_ms=${releaseMs}`,
        `released_players=${item.released.length * 4}`,
        `team_gap=${item.baseline.metrics.maxTeamGap.toFixed(3)}->${item.waited.metrics.maxTeamGap.toFixed(3)}`,
        `intra=${item.baseline.metrics.maxIntraGap.toFixed(3)}->${item.waited.metrics.maxIntraGap.toFixed(3)}`,
        `partner_repeat=${item.baseline.metrics.partnerRepeats}->${item.waited.metrics.partnerRepeats}`,
        `opponent_repeat=${item.baseline.metrics.opponentRepeats}->${item.waited.metrics.opponentRepeats}`,
        `safe=${safeQualityWin(item.waited, item.baseline)}`,
        `runtime_ms=${item.waited.runtimeMs.toFixed(1)}`,
      ].join(' '))
    }
    return
  }

  for (const row of rows) {
    const baseline = replay(row, 'current')
    results.get('current')!.push(baseline)
    for (const policy of POLICIES.slice(1)) {
      const candidate = replay(row, policy)
      results.get(policy)!.push(candidate)
      if (safeQualityWin(candidate, baseline)) safeWins.set(policy, (safeWins.get(policy) ?? 0) + 1)
    }
  }

  console.log('ENGINE-FAITHFUL REQUEST REPLAY')
  console.log(`requests=${rows.length} policies=${POLICIES.length}`)
  const historicalMatches = results.get('current')!
    .filter((result, index) => matchesHistorical(rows[index], result)).length
  console.log(`current_engine_exact_historical=${historicalMatches}/${rows.length}`)
  for (const policy of POLICIES) {
    const policyResults = results.get(policy)!
    const metrics = policyResults.map(result => result.metrics)
    const runtimes = policyResults.map(result => result.runtimeMs)
    const boards = metrics.reduce((sum, metric) => sum + metric.boards, 0)
    const invariantFailures = policyResults.filter(result => result.invariantErrors.length > 0).length
    const overBudget = policyResults.filter(result => result.runtimeMs > 2_000).length
    console.log([
      `policy=${policy}`,
      `boards=${boards}`,
      `avg_team_gap=${mean(metrics.map(metric => metric.teamGap / Math.max(1, metric.boards))).toFixed(3)}`,
      `worst_team_gap=${Math.max(0, ...metrics.map(metric => metric.maxTeamGap)).toFixed(3)}`,
      `avg_intra=${mean(metrics.map(metric => metric.intraGap / Math.max(1, metric.boards))).toFixed(3)}`,
      `worst_intra=${Math.max(0, ...metrics.map(metric => metric.maxIntraGap)).toFixed(3)}`,
      `partner_repeat_burden=${metrics.reduce((sum, metric) => sum + metric.partnerRepeats, 0)}`,
      `opponent_repeat_burden=${metrics.reduce((sum, metric) => sum + metric.opponentRepeats, 0)}`,
      `safe_wins_vs_current=${safeWins.get(policy) ?? 0}`,
      `p95_ms=${percentile(runtimes, 0.95).toFixed(1)}`,
      `max_ms=${Math.max(0, ...runtimes).toFixed(1)}`,
      `invariant_failures=${invariantFailures}`,
      `over_2s=${overBudget}`,
    ].join(' '))
  }

  const current = results.get('current')!
  const worst = current
    .map((result, index) => ({ result, row: rows[index] }))
    .sort((a, b) => b.result.metrics.maxTeamGap - a.result.metrics.maxTeamGap)
    .slice(0, 5)
  console.log('WORST CURRENT REQUESTS')
  for (const item of worst) {
    const request = item.row.request_v2
    console.log([
      `dump=${item.row.id}`,
      `at=${item.row.created_at}`,
      `round=${item.row.state?.current_round}`,
      `courts=${JSON.stringify(request.court_idxs ?? [])}`,
      `boards=${item.result.metrics.boards}`,
      `team_gap=${item.result.metrics.maxTeamGap.toFixed(3)}`,
      `intra=${item.result.metrics.maxIntraGap.toFixed(3)}`,
      `eligible=${item.result.debug.map(debug => debug.eligible_players.length).join(',')}`,
    ].join(' '))
    const historicalMetrics = measure(
      (item.row.chosen_matches ?? []).filter((match: JsonRecord) => !match.is_replacement),
      buildState(item.row),
    )
    console.log([
      '  historical_actual',
      `team_gap=${historicalMetrics.maxTeamGap.toFixed(3)}`,
      `intra=${historicalMetrics.maxIntraGap.toFixed(3)}`,
      `partner_repeat=${historicalMetrics.partnerRepeats}`,
      `opponent_repeat=${historicalMetrics.opponentRepeats}`,
    ].join(' '))
    const rowIndex = rows.indexOf(item.row)
    for (const policy of POLICIES.slice(1)) {
      const candidate = results.get(policy)![rowIndex]
      console.log([
        `  ${policy}`,
        `team_gap=${candidate.metrics.maxTeamGap.toFixed(3)}`,
        `intra=${candidate.metrics.maxIntraGap.toFixed(3)}`,
        `partner_repeat=${candidate.metrics.partnerRepeats}`,
        `opponent_repeat=${candidate.metrics.opponentRepeats}`,
        `safe_win=${safeQualityWin(candidate, item.result)}`,
      ].join(' '))
    }
  }
}

main()
