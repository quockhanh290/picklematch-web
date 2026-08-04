import fs from 'node:fs'
import path from 'node:path'

import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildSuggestedMatchPayloads,
  type SuggestedMatchPayload,
} from '../../lib/next-round-suggester/live-preview'
import { getEffectivePvna } from '../../lib/next-round-suggester/state'
import type {
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionState,
  Team,
} from '../../lib/next-round-suggester/types'

const BASE_DIR = path.join('diagnostics', 'session-replay')
const BASELINE_PATH = path.join('diagnostics', 'suggest-quality-baseline.json')
const ROUNDS = 7
const LATE_ROUND = 4
const EPSILON = 1e-9
const CORPUS = [
  '341faad1-cbd0-4e86-99a5-0d897f83ea38',
  '9485bd3a-d6e7-4597-9d04-ab682fe750f5',
  '967e6682-207d-4d92-aec9-dbe56b54ca2b',
] as const

type CompletionOrder = 'forward' | 'reverse'

type Observation = {
  round: number
  fillRank: number
  teamGap: number
  intraGap: number
  partnerRepeats: number
  opponentRepeats: number
}

type MetricSet = {
  opp_repeat_rate: number
  late_opp_repeat_rate: number
  partner_repeat_rate: number
  relaxed_rate: number
  intra_gap_avg: number
  match_count_spread: number
  tail_last_fill_quality: number
  incomplete_fills: number
}

type GateResults = {
  generated_at: string
  rounds: number
  corpus: Record<string, MetricSet>
}

function readJsonl(filePath: string): any[] {
  return fs.readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function loadSession(sessionId: string): { state: SessionState; courts: number } {
  const dumps = readJsonl(path.join(BASE_DIR, sessionId, 'debug_dumps.jsonl'))
  const freshPlayers = dumps
    .map(row => row.payload?.players ?? row.payload?.player_snapshot_lite)
    .find(players => (
      Array.isArray(players) &&
      players.length > 0 &&
      players.every(player => player.matches_played === 0)
    ))
  if (!freshPlayers) {
    throw new Error(`${sessionId}: no initial player snapshot with matches_played === 0 in debug_dumps.jsonl`)
  }
  const config = dumps
    .map(row => row.payload?.derived_state_summary?.config)
    .find(Boolean)
  if (!config) throw new Error(`${sessionId}: no derived_state_summary.config in debug_dumps.jsonl`)

  const players: PlayerSessionState[] = freshPlayers.map(player => ({
    player_id: player.id ?? player.player_id,
    pvna: player.pvna,
    effective_pvna: player.effective_pvna ?? null,
    gender: player.gender ?? null,
    group_id: player.group_id ?? null,
    partner_gender_pref: player.partner_gender_pref ?? 'any',
    opponent_gender_pref: player.opponent_gender_pref ?? 'any',
    checked_in_at: new Date('2026-05-15T12:00:00Z'),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_play: 0,
    consecutive_rest: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    rounds_available: 0,
  }))
  const state: SessionState = {
    session_id: sessionId,
    current_round: 1,
    status: 'active',
    config: {
      courts: config.courts,
      pvna_tolerance: config.pvna_tolerance,
      court_preset: config.court_preset,
      weights: config.weights,
      planned_total_rounds: config.planned_total_rounds,
    },
    players: new Map(players.map(player => [player.player_id, player])),
    rounds: [],
  }
  return { state, courts: config.courts }
}

function asLiveRow(payload: SuggestedMatchPayload, sequenceNo: number, laneRound: number): SessionLiveMatchRow {
  const timestamp = new Date(sequenceNo * 1000).toISOString()
  return {
    id: `quality-gate-${sequenceNo}`,
    session_id: 'quality-gate',
    sequence_no: sequenceNo,
    round_no: laneRound,
    cycle_no: laneRound,
    court_idx: payload.court_idx,
    status: 'live',
    team_a: payload.team_a,
    team_b: payload.team_b,
    resting: payload.resting,
    score_a: 0,
    score_b: 0,
    suggested_at: timestamp,
    started_at: timestamp,
    ended_at: null,
  }
}

function suggest(
  state: SessionState,
  liveRows: SessionLiveMatchRow[],
  count: number,
  courts: number,
  courtIdxs?: number[],
): SuggestedMatchPayload[] {
  return buildSuggestedMatchPayloads({
    count,
    sessionId: state.session_id,
    courtCount: courts,
    state,
    rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state),
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
    pvnaTolerance: state.config.pvna_tolerance,
    options: {
      courtIdxs,
      ignoreCapacityLock: true,
      rollingHorizon: false,
      rollingPlanTarget: null,
      seedSalt: `quality-gate:${state.session_id}:${liveRows.length}:${courtIdxs?.join(',') ?? 'board'}`,
    },
  })
}

function pvna(state: SessionState, playerId: string) {
  const player = state.players.get(playerId)
  return player ? getEffectivePvna(player) : 0
}

function observe(state: SessionState, teamA: Team, teamB: Team, round: number, fillRank: number): Observation {
  const teamGap = Math.abs(
    pvna(state, teamA[0]) + pvna(state, teamA[1])
      - pvna(state, teamB[0]) - pvna(state, teamB[1]),
  )
  const intraGap = Math.max(
    Math.abs(pvna(state, teamA[0]) - pvna(state, teamA[1])),
    Math.abs(pvna(state, teamB[0]) - pvna(state, teamB[1])),
  )
  const partnerRepeats =
    ((state.players.get(teamA[0])?.partner_counts.get(teamA[1]) ?? 0) > 0 ? 1 : 0) +
    ((state.players.get(teamB[0])?.partner_counts.get(teamB[1]) ?? 0) > 0 ? 1 : 0)
  let opponentRepeats = 0
  for (const left of teamA) {
    for (const right of teamB) {
      if ((state.players.get(left)?.opponent_counts.get(right) ?? 0) > 0) opponentRepeats += 1
    }
  }
  return { round, fillRank, teamGap, intraGap, partnerRepeats, opponentRepeats }
}

function runSession(sessionId: string, order: CompletionOrder) {
  let { state, courts } = loadSession(sessionId)
  let liveRows: SessionLiveMatchRow[] = []
  let sequenceNo = 0
  let incompleteFills = 0
  const observations: Observation[] = []
  const appearances = new Map([...state.players.keys()].map(id => [id, 0]))
  const laneCompleted = new Map(Array.from({ length: courts }, (_, courtIdx) => [courtIdx, 0]))
  const courtOrder = Array.from({ length: courts }, (_, courtIdx) => courtIdx)
  if (order === 'reverse') courtOrder.reverse()

  const initial = suggest(state, liveRows, courts, courts)
  if (initial.length !== courts) {
    return { observations, appearances, incompleteFills: courts, courts }
  }
  initial.forEach((payload, fillRank) => {
    observations.push(observe(state, payload.team_a, payload.team_b, 0, fillRank))
    for (const playerId of [...payload.team_a, ...payload.team_b]) {
      appearances.set(playerId, (appearances.get(playerId) ?? 0) + 1)
    }
    liveRows.push(asLiveRow(payload, sequenceNo, 0))
    sequenceNo += 1
  })

  let completedEvents = 0
  let fillRankThisRound = 0
  let completedRoundPlayerIds = new Set<string>()
  const targetCompletedEvents = courts * ROUNDS
  let guard = 0
  while (completedEvents < targetCompletedEvents && guard < targetCompletedEvents * 4) {
    guard += 1
    for (const courtIdx of courtOrder) {
      if ((laneCompleted.get(courtIdx) ?? 0) >= ROUNDS) continue
      const live = liveRows.find(row => row.status === 'live' && row.court_idx === courtIdx)
      if (!live) continue

      state = buildProjectedStateAfterLiveMatch(
        state,
        { ...live, status: 'completed', ended_at: new Date((sequenceNo + 1) * 1000).toISOString() },
        live.round_no ?? 0,
      )
      for (const playerId of [...live.team_a, ...live.team_b]) completedRoundPlayerIds.add(playerId)
      liveRows = liveRows.filter(row => row.id !== live.id)
      laneCompleted.set(courtIdx, (laneCompleted.get(courtIdx) ?? 0) + 1)
      completedEvents += 1

      if (completedEvents % courts === 0) {
        state = {
          ...buildProjectedStateAfterCompletedLiveRound(state, completedRoundPlayerIds),
          current_round: Math.max(state.current_round, Math.floor(completedEvents / courts) + 1),
        }
        completedRoundPlayerIds = new Set()
        fillRankThisRound = 0
      }

      const idleCourts = Array.from({ length: courts }, (_, index) => index)
        .filter(index => (
          (laneCompleted.get(index) ?? 0) < ROUNDS &&
          !liveRows.some(row => row.status === 'live' && row.court_idx === index)
        ))
      for (const idleCourtIdx of idleCourts) {
        const next = suggest(state, liveRows, 1, courts, [idleCourtIdx])
        if (next.length !== 1) {
          incompleteFills += 1
          continue
        }
        const payload = next[0]
        const laneRound = laneCompleted.get(idleCourtIdx) ?? 0
        observations.push(observe(state, payload.team_a, payload.team_b, laneRound, fillRankThisRound))
        fillRankThisRound += 1
        for (const playerId of [...payload.team_a, ...payload.team_b]) {
          appearances.set(playerId, (appearances.get(playerId) ?? 0) + 1)
        }
        liveRows.push(asLiveRow(payload, sequenceNo, laneRound))
        sequenceNo += 1
      }
    }
  }

  return { observations, appearances, incompleteFills, courts }
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function quality(observation: Observation) {
  return observation.teamGap * 7 +
    observation.intraGap * 7 +
    observation.partnerRepeats * 4 +
    observation.opponentRepeats * 2
}

function metricForRun(
  observations: Observation[],
  appearances: Map<string, number>,
  incompleteFills: number,
  tolerance: number,
): MetricSet {
  const late = observations.filter(observation => observation.round >= LATE_ROUND)
  const lastRank = Math.max(0, ...observations.map(observation => observation.fillRank))
  const lastRankObservations = observations.filter(observation => observation.fillRank === lastRank)
  const counts = [...appearances.values()]
  return {
    opp_repeat_rate: observations.length ? observations.filter(o => o.opponentRepeats > 0).length / observations.length : 0,
    late_opp_repeat_rate: late.length ? late.filter(o => o.opponentRepeats > 0).length / late.length : 0,
    partner_repeat_rate: observations.length ? observations.filter(o => o.partnerRepeats > 0).length / observations.length : 0,
    relaxed_rate: observations.length ? observations.filter(o => o.teamGap > tolerance).length / observations.length : 0,
    intra_gap_avg: average(observations.map(o => o.intraGap)),
    match_count_spread: counts.length ? Math.max(...counts) - Math.min(...counts) : 0,
    tail_last_fill_quality: average(lastRankObservations.map(quality)),
    incomplete_fills: incompleteFills,
  }
}

function roundMetric(value: number) {
  return Number(value.toFixed(6))
}

function averageMetrics(metrics: MetricSet[]): MetricSet {
  return {
    opp_repeat_rate: roundMetric(average(metrics.map(m => m.opp_repeat_rate))),
    late_opp_repeat_rate: roundMetric(average(metrics.map(m => m.late_opp_repeat_rate))),
    partner_repeat_rate: roundMetric(average(metrics.map(m => m.partner_repeat_rate))),
    relaxed_rate: roundMetric(average(metrics.map(m => m.relaxed_rate))),
    intra_gap_avg: roundMetric(average(metrics.map(m => m.intra_gap_avg))),
    match_count_spread: roundMetric(average(metrics.map(m => m.match_count_spread))),
    tail_last_fill_quality: roundMetric(average(metrics.map(m => m.tail_last_fill_quality))),
    incomplete_fills: roundMetric(average(metrics.map(m => m.incomplete_fills))),
  }
}

function runCorpus(): GateResults {
  const originalWarn = console.warn
  const OriginalDate = Date
  const originalDateNow = Date.now
  const originalPerformanceNow = globalThis.performance?.now
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('projection drift')) return
    originalWarn(...args)
  }
  const fixedNow = 1_700_000_000_000
  const FixedDate = class extends OriginalDate {
    constructor(value?: string | number | Date) {
      super(value ?? fixedNow)
    }
    static now() {
      return fixedNow
    }
  } as DateConstructor
  globalThis.Date = FixedDate
  Date.now = () => fixedNow
  if (globalThis.performance && originalPerformanceNow) {
    globalThis.performance.now = () => 1_000
  }
  try {
    const corpus: Record<string, MetricSet> = {}
    for (const sessionId of CORPUS) {
      const tolerance = loadSession(sessionId).state.config.pvna_tolerance
      corpus[sessionId] = averageMetrics((['forward', 'reverse'] as CompletionOrder[]).map(order => {
        const result = runSession(sessionId, order)
        return metricForRun(result.observations, result.appearances, result.incompleteFills, tolerance)
      }))
    }
    return {
      generated_at: new Date(0).toISOString(),
      rounds: ROUNDS,
      corpus,
    }
  } finally {
    console.warn = originalWarn
    globalThis.Date = OriginalDate
    Date.now = originalDateNow
    if (globalThis.performance && originalPerformanceNow) {
      globalThis.performance.now = originalPerformanceNow.bind(globalThis.performance)
    }
  }
}

function formatValue(metric: keyof MetricSet, value: number) {
  if (metric.endsWith('_rate')) return `${(value * 100).toFixed(1)}%`
  return value.toFixed(metric === 'incomplete_fills' || metric === 'match_count_spread' ? 1 : 3)
}

function formatDelta(metric: keyof MetricSet, value: number) {
  const sign = value > 0 ? '+' : ''
  if (metric.endsWith('_rate')) return `${sign}${(value * 100).toFixed(1)}pts`
  return `${sign}${value.toFixed(metric === 'incomplete_fills' || metric === 'match_count_spread' ? 1 : 3)}`
}

function printTable(baseline: GateResults, current: GateResults) {
  const metrics = Object.keys(current.corpus[CORPUS[0]]) as Array<keyof MetricSet>
  for (const sessionId of CORPUS) {
    console.log(`\n${sessionId}`)
    console.log('metric                     baseline   current    delta')
    for (const metric of metrics) {
      const base = baseline.corpus[sessionId][metric]
      const now = current.corpus[sessionId][metric]
      const delta = now - base
      console.log(
        `${metric.padEnd(26)} ${formatValue(metric, base).padStart(9)} ${formatValue(metric, now).padStart(9)} ${formatDelta(metric, delta).padStart(9)}`,
      )
    }
  }
}

function validateGate(baseline: GateResults, current: GateResults) {
  const failures: string[] = []
  let anyDelta = false
  let totalOppDelta = 0
  let totalLateOppDelta = 0
  for (const sessionId of CORPUS) {
    const base = baseline.corpus[sessionId]
    const now = current.corpus[sessionId]
    for (const metric of Object.keys(now) as Array<keyof MetricSet>) {
      if (Math.abs(now[metric] - base[metric]) > EPSILON) anyDelta = true
    }
    const relaxedDelta = now.relaxed_rate - base.relaxed_rate
    const partnerDelta = now.partner_repeat_rate - base.partner_repeat_rate
    const incompleteDelta = now.incomplete_fills - base.incomplete_fills
    const oppDelta = now.opp_repeat_rate - base.opp_repeat_rate
    const spreadDelta = now.match_count_spread - base.match_count_spread
    totalOppDelta += oppDelta
    totalLateOppDelta += now.late_opp_repeat_rate - base.late_opp_repeat_rate
    if (relaxedDelta > 0.03 + EPSILON) failures.push(`${sessionId}: I1 relaxed_rate delta ${formatDelta('relaxed_rate', relaxedDelta)} > +3.0pts`)
    if (partnerDelta > EPSILON) failures.push(`${sessionId}: I2 partner_repeat_rate increased by ${formatDelta('partner_repeat_rate', partnerDelta)}`)
    if (incompleteDelta > EPSILON) failures.push(`${sessionId}: I3 incomplete_fills increased by ${formatDelta('incomplete_fills', incompleteDelta)}`)
    if (anyDelta) {
      if (oppDelta > 0.01 + EPSILON) failures.push(`${sessionId}: opp_repeat_rate increased by more than 1pt (${formatDelta('opp_repeat_rate', oppDelta)})`)
      if (spreadDelta > EPSILON) failures.push(`${sessionId}: match_count_spread worsened by ${formatDelta('match_count_spread', spreadDelta)}`)
    }
  }
  if (anyDelta) {
    const averageOppDelta = totalOppDelta / CORPUS.length
    const averageLateOppDelta = totalLateOppDelta / CORPUS.length
    if (averageOppDelta > -0.03 + EPSILON) {
      failures.push(`average opp_repeat_rate did not decrease by at least 3pts (${formatDelta('opp_repeat_rate', averageOppDelta)})`)
    }
    if (averageLateOppDelta > EPSILON) {
      failures.push(`average late_opp_repeat_rate worsened (${formatDelta('late_opp_repeat_rate', averageLateOppDelta)})`)
    }
  }
  return failures
}

function writeBaseline(results: GateResults) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(results, null, 2)}\n`)
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const current = runCorpus()
  if (updateBaseline || !fs.existsSync(BASELINE_PATH)) {
    writeBaseline(current)
    console.log(`${updateBaseline ? 'Updated' : 'Created'} ${BASELINE_PATH}`)
    printTable(current, current)
    return
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as GateResults
  printTable(baseline, current)
  const failures = validateGate(baseline, current)
  if (failures.length > 0) {
    console.error('\nGate failed:')
    failures.forEach(failure => console.error(`- ${failure}`))
    process.exitCode = 1
    return
  }
  console.log('\nGate passed.')
}

main()
