import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector'
import type { SessionLiveMatchRow, SessionState } from '../../../lib/next-round-suggester/types'
import { runSimulation, type SimulationConfig } from './runner'

type TimingResult = {
  samples: number
  avg_ms: number
  p50_ms: number
  p95_ms: number
  max_ms: number
}

function stateToCompletedRows(state: SessionState): SessionLiveMatchRow[] {
  const rows: SessionLiveMatchRow[] = []
  let seqNo = 0
  for (const round of state.rounds) {
    for (const match of round.matches) {
      rows.push({
        id: `committed-r${round.round_no}-c${match.court_idx ?? seqNo}`,
        session_id: state.session_id,
        sequence_no: seqNo++,
        round_no: round.round_no,
        court_idx: match.court_idx ?? null,
        status: 'completed',
        team_a: match.team_a,
        team_b: match.team_b,
        resting: [],
        score_a: 0,
        score_b: 0,
        suggested_at: round.started_at?.toISOString() ?? new Date().toISOString(),
        started_at: round.started_at?.toISOString() ?? null,
        ended_at: round.ended_at?.toISOString() ?? null,
      })
    }
  }
  return rows
}

function computeTimingStats(timings: number[]): TimingResult {
  const sorted = [...timings].sort((a, b) => a - b)
  const avg = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1)
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0
  const max = sorted[sorted.length - 1] ?? 0
  return { samples: sorted.length, avg_ms: avg, p50_ms: p50, p95_ms: p95, max_ms: max }
}

// Measures the time from "live match ends" to "next match suggestion ready".
// Lifecycle: warm state built from committed rounds → one match completing on one court
// while liveCourtCount-1 other courts are actively playing.
async function benchmarkLiveMatchSuggestion(params: {
  scenario: SimulationConfig
  liveCourtCount: number
  iterations: number
}): Promise<TimingResult> {
  const { final_state: state } = await runSimulation(params.scenario)

  const baseRows = stateToCompletedRows(state)
  const presentPlayers = [...state.players.values()]
    .filter(p => p.checked_out_at === null && !p.opted_rest)
    .sort((a, b) => a.player_id.localeCompare(b.player_id))

  const seqBase = baseRows.length
  const liveRows: SessionLiveMatchRow[] = []

  // Other courts currently live (these match completions are NOT measured)
  for (let courtIdx = 0; courtIdx < params.liveCourtCount - 1; courtIdx++) {
    const offset = courtIdx * 4
    if (offset + 3 >= presentPlayers.length) break
    liveRows.push({
      id: `live-bench-court-${courtIdx}`,
      session_id: state.session_id,
      sequence_no: seqBase + courtIdx,
      round_no: state.current_round,
      court_idx: courtIdx,
      status: 'live',
      team_a: [presentPlayers[offset].player_id, presentPlayers[offset + 1].player_id],
      team_b: [presentPlayers[offset + 2].player_id, presentPlayers[offset + 3].player_id],
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
    })
  }

  // The match that just completed — this is the event we benchmark
  const completingOffset = Math.max(0, params.liveCourtCount - 1) * 4
  const completingMatchId = 'bench-completing-match'
  const completingRow: SessionLiveMatchRow = {
    id: completingMatchId,
    session_id: state.session_id,
    sequence_no: seqBase + params.liveCourtCount,
    round_no: state.current_round,
    court_idx: params.liveCourtCount - 1,
    status: 'live',
    team_a: [
      presentPlayers[completingOffset]?.player_id ?? 'p1',
      presentPlayers[completingOffset + 1]?.player_id ?? 'p2',
    ],
    team_b: [
      presentPlayers[completingOffset + 2]?.player_id ?? 'p3',
      presentPlayers[completingOffset + 3]?.player_id ?? 'p4',
    ],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: null,
  }

  const allRows = [...baseRows, ...liveRows, completingRow]
  const completingIds = new Set([completingMatchId])
  const playersById = new Map([...state.players.values()].map(p => [p.player_id, { name: p.player_id }]))
  const adjustment = correctForFairness(state)
  const warnings = detectFairnessIssues(state)

  const timings: number[] = []
  for (let i = 0; i < params.iterations; i++) {
    const t0 = performance.now()
    buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: params.scenario.courts,
      state,
      rows: { liveMatchRows: allRows },
      completingLiveMatchIds: completingIds,
      fairnessAdjustment: {
        tier_overrides: adjustment.tier_overrides,
        applied_for_warnings: adjustment.applied_for_warnings.map(String),
      },
      fairnessWarnings: warnings,
      playersById,
      pvnaTolerance: 0.5,
    })
    timings.push(performance.now() - t0)
  }

  return computeTimingStats(timings)
}

// Player counts are courts*4+4 so there's always one resting group available for the next suggestion.
// liveCourtCount covers all courts: (liveCourtCount-1) are live, 1 is completing.

describe('Live Match Suggestion Timing', () => {
  it(
    'small session (12p, 2 courts): suggestion latency after match ends',
    async () => {
      const result = await benchmarkLiveMatchSuggestion({
        scenario: baseScenario('bench_small_12', 12, 2, 6, 'wide'),
        liveCourtCount: 2,
        iterations: 30,
      })

      console.log('[timing] small 12p/2c', result)
      expect(result.avg_ms).toBeLessThan(50)
      expect(result.p95_ms).toBeLessThan(100)
    },
    60000,
  )

  it(
    'medium session (20p, 4 courts): suggestion latency after match ends',
    async () => {
      const result = await benchmarkLiveMatchSuggestion({
        scenario: baseScenario('bench_medium_20', 20, 4, 8, 'wide'),
        liveCourtCount: 4,
        iterations: 20,
      })

      console.log('[timing] medium 20p/4c', result)
      expect(result.avg_ms).toBeLessThan(150)
      expect(result.p95_ms).toBeLessThan(300)
    },
    120000,
  )

  it(
    'large session (44p, 10 courts): suggestion latency after match ends',
    async () => {
      const result = await benchmarkLiveMatchSuggestion({
        scenario: baseScenario('bench_large_44', 44, 10, 8, 'wide'),
        liveCourtCount: 10,
        iterations: 15,
      })

      console.log('[timing] large 44p/10c', result)
      expect(result.avg_ms).toBeLessThan(1000)
      expect(result.p95_ms).toBeLessThan(2000)
    },
    600000,
  )

  it(
    'late-session (44p, 10 courts, 15 warm rounds): timing stays within budget',
    async () => {
      const result = await benchmarkLiveMatchSuggestion({
        scenario: baseScenario('bench_late_44', 44, 10, 15, 'wide'),
        liveCourtCount: 10,
        iterations: 10,
      })

      console.log('[timing] late-session 44p/10c/15r', result)
      expect(result.avg_ms).toBeLessThan(1000)
      expect(result.max_ms).toBeLessThan(2000)
    },
    600000,
  )
})

function baseScenario(
  name: string,
  nPlayers: number,
  courts: number,
  rounds: number,
  pvnaDistribution: SimulationConfig['pvna_distribution'],
): SimulationConfig {
  return {
    scenario_name: name,
    n_players: nPlayers,
    courts,
    rounds,
    pvna_distribution: pvnaDistribution,
    gender_ratio: 0.5,
    gender_pref_rate: 0.2,
    group_count: 0,
    group_size_range: [2, 4],
    use_corrector: true,
    seed: 42,
  }
}
