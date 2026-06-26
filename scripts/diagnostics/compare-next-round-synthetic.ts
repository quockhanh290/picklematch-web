import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import { DEFAULT_SCORING_WEIGHTS } from '@/lib/next-round-suggester/state'
import type {
  Gender,
  GenderPreference,
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
} from '@/lib/next-round-suggester/types'
import { suggestNextRoundExperimental } from '@/features/host/session-detail/next-round-benchmark/experimental-suggest'

type SimulationConfig = {
  n_players: number
  courts: number
  rounds: number
  pvna_distribution: 'tight' | 'wide' | 'extreme' | 'bimodal'
  gender_ratio: number
  gender_pref_rate: number
  group_count: number
  group_size_range: [number, number]
  seed: number
  scenario_name?: string
}

type ScenarioTemplate = Omit<SimulationConfig, 'seed' | 'scenario_name'>

type Rng = {
  quick: () => number
}

const SCENARIOS: Array<{ name: string; config: ScenarioTemplate }> = [
  {
    name: 'forty_wide_6_courts',
    config: scenario(40, 6, 12, 'wide', 0.5, 0.3, 5, [3, 6]),
  },
  {
    name: 'forty_extreme_6_courts',
    config: scenario(40, 6, 12, 'extreme', 0.5, 0.35, 5, [3, 6]),
  },
  {
    name: 'forty_gender_pressure_6_courts',
    config: scenario(40, 6, 12, 'wide', 0.3, 0.75, 4, [3, 6]),
  },
  {
    name: 'forty_group_pressure_6_courts',
    config: scenario(40, 6, 12, 'wide', 0.5, 0.3, 8, [3, 5]),
  },
]

function argValue(name: string, fallback: string) {
  const args = process.argv.slice(2)
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? fallback : fallback
}

function createRng(seed: number): Rng {
  let value = seed >>> 0
  return {
    quick: () => {
      value += 0x6d2b79f5
      let t = value
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function scenario(
  nPlayers: number,
  courts: number,
  rounds: number,
  pvnaDistribution: SimulationConfig['pvna_distribution'],
  genderRatio: number,
  genderPrefRate: number,
  groupCount: number,
  groupSizeRange: [number, number],
): ScenarioTemplate {
  return {
    n_players: nPlayers,
    courts,
    rounds,
    pvna_distribution: pvnaDistribution,
    gender_ratio: genderRatio,
    gender_pref_rate: genderPrefRate,
    group_count: groupCount,
    group_size_range: groupSizeRange,
  }
}

function generatePlayers(config: SimulationConfig, rng: Rng): PlayerSessionState[] {
  const pvnas = generatePvnas(config.n_players, config.pvna_distribution, rng)
  const genders = generateGenders(config.n_players, config.gender_ratio, rng)
  const groupAssignments = generateGroups(
    config.n_players,
    config.group_count,
    config.group_size_range,
    rng,
  )
  const prefs = generateGenderPrefs(config.n_players, config.gender_pref_rate, rng)
  const checkedInAt = new Date('2026-05-15T12:00:00.000Z')

  return Array.from({ length: config.n_players }, (_, index) => ({
    player_id: `player_${String(index + 1).padStart(2, '0')}`,
    pvna: pvnas[index],
    gender: genders[index],
    group_id: groupAssignments[index],
    partner_gender_pref: prefs[index].partner,
    opponent_gender_pref: prefs[index].opponent,
    checked_in_at: checkedInAt,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_play: 0,
    consecutive_rest: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
  }))
}

function initState(players: PlayerSessionState[], courts: number): SessionState {
  return {
    session_id: 'synthetic-session',
    current_round: 1,
    status: 'active',
    config: {
      courts,
      pvna_tolerance: 0.5,
      weights: DEFAULT_SCORING_WEIGHTS,
    },
    players: new Map(players.map((player) => [player.player_id, clonePlayer(player)])),
    rounds: [],
  }
}

function generatePvnas(
  count: number,
  distribution: SimulationConfig['pvna_distribution'],
  rng: Rng,
) {
  if (distribution === 'tight') {
    return Array.from({ length: count }, () => roundPvna(3.3 + (rng.quick() - 0.5) * 1.0))
  }
  if (distribution === 'extreme') {
    return Array.from({ length: count }, () => roundPvna(3.5 + (rng.quick() - 0.5) * 3.0))
  }
  if (distribution === 'bimodal') {
    return Array.from({ length: count }, () =>
      rng.quick() < 0.5 ? roundPvna(2.7 + rng.quick() * 0.35) : roundPvna(4.0 + rng.quick() * 0.45),
    )
  }
  return Array.from({ length: count }, () => roundPvna(3.5 + (rng.quick() - 0.5) * 2.0))
}

function generateGenders(count: number, femaleRatio: number, rng: Rng): Gender[] {
  return Array.from({ length: count }, () => {
    if (rng.quick() < 0.05) return null
    return rng.quick() < femaleRatio ? 'F' : 'M'
  })
}

function generateGroups(
  count: number,
  groupCount: number,
  sizeRange: [number, number],
  rng: Rng,
): Array<string | null> {
  const assignments: Array<string | null> = new Array(count).fill(null)
  if (groupCount <= 0) return assignments

  const indices = Array.from({ length: count }, (_, index) => index)
  shuffle(indices, rng)

  let cursor = 0
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const size = Math.floor(rng.quick() * (sizeRange[1] - sizeRange[0] + 1)) + sizeRange[0]
    if (cursor + size > count) break
    const groupId = `group_${groupIndex + 1}`
    for (let member = 0; member < size; member += 1) {
      assignments[indices[cursor + member]] = groupId
    }
    cursor += size
  }

  return assignments
}

function generateGenderPrefs(
  count: number,
  rate: number,
  rng: Rng,
): Array<{ partner: GenderPreference; opponent: GenderPreference }> {
  const choices: GenderPreference[] = ['M', 'F', 'any']
  return Array.from({ length: count }, () => {
    if (rng.quick() >= rate) return { partner: 'any', opponent: 'any' }
    return {
      partner: choices[Math.floor(rng.quick() * choices.length)],
      opponent: rng.quick() < 0.3 ? choices[Math.floor(rng.quick() * choices.length)] : 'any',
    }
  })
}

function shuffle<T>(items: T[], rng: Rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.quick() * (index + 1))
    const current = items[index]
    items[index] = items[swapIndex]
    items[swapIndex] = current
  }
}

function clonePlayer(player: PlayerSessionState): PlayerSessionState {
  return {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }
}

function roundPvna(value: number) {
  return Number(value.toFixed(2))
}

function selectedIds(alternative: SuggestionAlternative | undefined) {
  return new Set((alternative?.matches ?? []).flatMap((match) => [...match.team_a, ...match.team_b]))
}

function matchCountRange(state: SessionState, alternative: SuggestionAlternative | undefined) {
  const ids = selectedIds(alternative)
  const presentPlayers = [...state.players.values()].filter((player) => player.checked_out_at === null)
  const projected = presentPlayers.map((player) => player.matches_played + (ids.has(player.player_id) ? 1 : 0))
  if (projected.length === 0) return 0
  return Math.max(...projected) - Math.min(...projected)
}

function metrics(state: SessionState, result: SuggestionResult) {
  const alt = result.alternatives[0]
  return {
    alternatives: result.alternatives.length,
    score: alt?.score ?? null,
    matchCountRange: matchCountRange(state, alt),
    partnerRepeats: alt?.stats.partner_repeats ?? null,
    opponentRepeats: alt?.stats.opponent_repeats ?? null,
    pvnaDiff: alt?.stats.pvna_diff ?? null,
    genderPenalty: alt?.stats.gender_pref_penalty ?? null,
  }
}

function numericDelta(a: number | null, b: number | null) {
  return a === null || b === null ? null : Number((b - a).toFixed(2))
}

function delta(
  baseline: ReturnType<typeof metrics>,
  experimental: ReturnType<typeof metrics>,
) {
  return {
    score: numericDelta(baseline.score, experimental.score),
    matchCountRange: experimental.matchCountRange - baseline.matchCountRange,
    partnerRepeats: numericDelta(baseline.partnerRepeats, experimental.partnerRepeats),
    opponentRepeats: numericDelta(baseline.opponentRepeats, experimental.opponentRepeats),
    pvnaDiff: numericDelta(baseline.pvnaDiff, experimental.pvnaDiff),
    genderPenalty: numericDelta(baseline.genderPenalty, experimental.genderPenalty),
    alternatives: experimental.alternatives - baseline.alternatives,
  }
}

function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows: SessionPairHistoryRow[] = []
  const seen = new Set<string>()

  for (const player of state.players.values()) {
    for (const [otherId, partnerCount] of player.partner_counts.entries()) {
      const [playerA, playerB] = player.player_id < otherId
        ? [player.player_id, otherId]
        : [otherId, player.player_id]
      const key = `${playerA}:${playerB}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        session_id: state.session_id,
        player_a: playerA,
        player_b: playerB,
        partner_count: partnerCount,
        opponent_count: player.opponent_counts.get(otherId) ?? 0,
      })
    }
  }

  return rows
}

function applyPairRows(players: Map<string, PlayerSessionState>, rows: SessionPairHistoryRow[]) {
  for (const player of players.values()) {
    player.partner_counts = new Map()
    player.opponent_counts = new Map()
  }

  for (const row of rows) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)
    if (!playerA || !playerB) continue
    playerA.partner_counts.set(row.player_b, row.partner_count)
    playerB.partner_counts.set(row.player_a, row.partner_count)
    playerA.opponent_counts.set(row.player_b, row.opponent_count)
    playerB.opponent_counts.set(row.player_a, row.opponent_count)
  }
}

function commitRound(state: SessionState, roundNo: number, matches: Match[], resting: string[]) {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: roundNo,
    status: 'completed',
    matches,
    resting,
    started_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 0)),
    ended_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 30)),
  }
  const committed = commitCompletedRound(state, round, pairRowsFromState(state))
  applyPairRows(committed.players, committed.pairHistory)

  return {
    ...state,
    current_round: roundNo + 1,
    players: committed.players,
    rounds: [...state.rounds, round],
  }
}

async function main() {
  const seeds = Math.max(1, Number(argValue('--seeds', '3')))
  const rounds = Math.max(1, Number(argValue('--rounds', '8')))
  const candidateLimit = Math.max(1, Number(argValue('--candidate-limit', '28')))
  const candidateMode = argValue('--candidate-mode', 'global') as 'global' | 'cached-global' | 'per-strategy' | 'adaptive' | 'strategy-stop' | 'cached-production'
  if (!['global', 'cached-global', 'per-strategy', 'adaptive', 'strategy-stop', 'cached-production'].includes(candidateMode)) {
    throw new Error('--candidate-mode must be global, cached-global, per-strategy, adaptive, strategy-stop, or cached-production')
  }
  const rows: any[] = []

  for (const template of SCENARIOS) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const config: SimulationConfig = {
        ...template.config,
        scenario_name: template.name,
        rounds,
        seed,
      }
      const players = generatePlayers(config, createRng(seed))
      let state = initState(players, config.courts)

      for (let roundNo = 1; roundNo <= rounds; roundNo += 1) {
        const adjustment = correctForFairness(state)
        const adjustedState = applyFairnessAdjustment(state, adjustment)

        const baselineStarted = now()
        const baseline = suggestNextRound(adjustedState, {
          tier_overrides: adjustment.tier_overrides,
          partition_cache: false,
        })
        const baselineMs = now() - baselineStarted

        const experimentalStarted = now()
        const experimental = suggestNextRoundExperimental(adjustedState, {
          tier_overrides: adjustment.tier_overrides,
          candidateLimit,
          mode: candidateMode,
        })
        const experimentalMs = now() - experimentalStarted

        const first = baseline.alternatives[0]
        if (!first) break

        const baselineMetrics = metrics(adjustedState, baseline)
        const experimentalMetrics = metrics(adjustedState, experimental)
        const rowDelta = delta(baselineMetrics, experimentalMetrics)
        rows.push({
          scenario: template.name,
          seed,
          roundNo,
          baselineMs: Math.round(baselineMs),
          experimentalMs: Math.round(experimentalMs),
          speedup: baselineMs > 0 && experimentalMs > 0
            ? Number((baselineMs / experimentalMs).toFixed(2))
            : null,
          delta: rowDelta,
          experimentalDiagnostic: experimental.diagnostic,
        })

        state = commitRound(state, roundNo, first.matches, first.resting)
      }
    }
  }

  const speedups = rows.map((row) => row.speedup ?? 0).filter((value) => value > 0)
  const scoreDeltas = rows.map((row) => row.delta.score).filter((value): value is number => value !== null)
  const avg = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
  const count = (predicate: (row: typeof rows[number]) => boolean) => rows.filter(predicate).length

  console.log(JSON.stringify({
    candidateLimit,
    candidateMode,
    scenarios: SCENARIOS.map((item) => item.name),
    seeds,
    rounds,
    summary: {
      checkpoints: rows.length,
      speedup: {
        min: Number(Math.min(...speedups).toFixed(2)),
        max: Number(Math.max(...speedups).toFixed(2)),
        avg: Number(avg(speedups).toFixed(2)),
        experimentalFaster: count((row) => (row.speedup ?? 0) > 1),
      },
      quality: {
        scoreBetter: count((row) => (row.delta.score ?? 0) < 0),
        scoreSame: count((row) => (row.delta.score ?? 0) === 0),
        scoreWorse: count((row) => (row.delta.score ?? 0) > 0),
        avgScoreDelta: Number(avg(scoreDeltas).toFixed(2)),
        worstScoreDelta: Number(Math.max(...scoreDeltas).toFixed(2)),
        bestScoreDelta: Number(Math.min(...scoreDeltas).toFixed(2)),
        alternativesRegressed: count((row) => row.delta.alternatives < 0),
        matchRangeWorse: count((row) => row.delta.matchCountRange > 0),
        partnerRepeatsWorse: count((row) => (row.delta.partnerRepeats ?? 0) > 0),
        opponentRepeatsWorse: count((row) => (row.delta.opponentRepeats ?? 0) > 0),
        pvnaWorse: count((row) => (row.delta.pvnaDiff ?? 0) > 0),
        genderPenaltyWorse: count((row) => (row.delta.genderPenalty ?? 0) > 0),
      },
      scoreRegressions: rows
        .filter((row) => (row.delta.score ?? 0) > 0)
        .map((row) => ({
          scenario: row.scenario,
          seed: row.seed,
          roundNo: row.roundNo,
          speedup: row.speedup,
          delta: row.delta,
        })),
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
