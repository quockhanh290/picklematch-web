import seedrandom from 'seedrandom'

import { commitCompletedRound, pairHistoryRowsFromState } from '../lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computePartnerDiversity,
  computeSessionFairness,
} from '../lib/next-round-suggester/fairness/metrics'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import { suggestNextRoundExperimental } from '../features/host/session-detail/next-round-benchmark/experimental-suggest'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
} from '../lib/next-round-suggester/types'
import { generatePlayers, initState } from '../tests/next-round-suggester/simulation/generators'
import type { SimulationConfig } from '../tests/next-round-suggester/simulation/runner'

type ScenarioTemplate = Omit<SimulationConfig, 'seed' | 'scenario_name' | 'use_corrector' | 'initial_players'>

const SCENARIOS: Array<{ name: string; config: ScenarioTemplate }> = [
  {
    name: 'forty_wide_6_courts',
    config: scenario(40, 6, 'wide', 0.5, 0.3, 5, [3, 6]),
  },
  {
    name: 'forty_extreme_6_courts',
    config: scenario(40, 6, 'extreme', 0.5, 0.35, 5, [3, 6]),
  },
  {
    name: 'forty_gender_pressure_6_courts',
    config: scenario(40, 6, 'wide', 0.3, 0.75, 4, [3, 6]),
  },
  {
    name: 'forty_group_pressure_6_courts',
    config: scenario(40, 6, 'wide', 0.5, 0.3, 8, [3, 5]),
  },
]

function argValue(name: string, fallback: string) {
  const args = process.argv.slice(2)
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? fallback : fallback
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function scenario(
  nPlayers: number,
  courts: number,
  pvnaDistribution: SimulationConfig['pvna_distribution'],
  genderRatio: number,
  genderPrefRate: number,
  groupCount: number,
  groupSizeRange: [number, number],
): ScenarioTemplate {
  return {
    n_players: nPlayers,
    courts,
    rounds: 50,
    pvna_distribution: pvnaDistribution,
    gender_ratio: genderRatio,
    gender_pref_rate: genderPrefRate,
    group_count: groupCount,
    group_size_range: groupSizeRange,
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}

function timing(values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return {
    avg: Number(avg.toFixed(1)),
    p50: Number(percentile(values, 50).toFixed(1)),
    p95: Number(percentile(values, 95).toFixed(1)),
    max: Number(Math.max(0, ...values).toFixed(1)),
  }
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

function groupPairs(state: SessionState, matches: Match[]) {
  let newPairs = 0
  let repeatedPairs = 0
  for (const match of matches) {
    for (const team of [match.team_a, match.team_b]) {
      const [left, right] = team
      const leftPlayer = state.players.get(left)
      const rightPlayer = state.players.get(right)
      if (!leftPlayer?.group_id || leftPlayer.group_id !== rightPlayer?.group_id) continue
      const count = leftPlayer.partner_counts.get(right) ?? 0
      if (count === 0) newPairs += 1
      else repeatedPairs += 1
    }
  }
  return { newPairs, repeatedPairs }
}

function metrics(state: SessionState, result: SuggestionResult) {
  const alternative = result.alternatives[0]
  const groups = groupPairs(state, alternative?.matches ?? [])
  return {
    enough3Alt: result.alternatives.length >= 3,
    alternatives: result.alternatives.length,
    score: alternative?.score ?? null,
    matchCountRange: matchCountRange(state, alternative),
    partnerRepeats: alternative?.stats.partner_repeats ?? null,
    opponentRepeats: alternative?.stats.opponent_repeats ?? null,
    pvnaDiff: alternative?.stats.pvna_diff ?? null,
    groupBonus: alternative?.stats.group_bonus ?? null,
    groupNewPairs: groups.newPairs,
    groupRepeatedPairs: groups.repeatedPairs,
    genderPenalty: alternative?.stats.gender_pref_penalty ?? null,
  }
}

function numericDelta(left: number | null, right: number | null) {
  return left === null || right === null ? null : Number((right - left).toFixed(2))
}

function metricDelta(
  baseline: ReturnType<typeof metrics>,
  cached: ReturnType<typeof metrics>,
) {
  return {
    score: numericDelta(baseline.score, cached.score),
    matchCountRange: cached.matchCountRange - baseline.matchCountRange,
    partnerRepeats: numericDelta(baseline.partnerRepeats, cached.partnerRepeats),
    opponentRepeats: numericDelta(baseline.opponentRepeats, cached.opponentRepeats),
    pvnaDiff: numericDelta(baseline.pvnaDiff, cached.pvnaDiff),
    groupBonus: numericDelta(baseline.groupBonus, cached.groupBonus),
    groupNewPairs: cached.groupNewPairs - baseline.groupNewPairs,
    groupRepeatedPairs: cached.groupRepeatedPairs - baseline.groupRepeatedPairs,
    genderPenalty: numericDelta(baseline.genderPenalty, cached.genderPenalty),
    alternatives: cached.alternatives - baseline.alternatives,
  }
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

function commitRound(state: SessionState, roundNo: number, alternative: SuggestionAlternative) {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: roundNo,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 0)),
    ended_at: new Date(Date.UTC(2026, 4, 15, 12, roundNo, 30)),
  }
  const committed = commitCompletedRound(state, round, pairHistoryRowsFromState(state))
  applyPairRows(committed.players, committed.pairHistory)
  return {
    ...state,
    current_round: roundNo + 1,
    players: committed.players,
    rounds: [...state.rounds, round],
  }
}

function signature(alternative: SuggestionAlternative | undefined) {
  return (alternative?.matches ?? [])
    .map((match) => [
      [...match.team_a].sort().join(':'),
      [...match.team_b].sort().join(':'),
    ].sort().join('>'))
    .sort()
    .join('|')
}

function finalQuality(state: SessionState) {
  const match = computeMatchCountMetrics(state)
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const gender = computeGenderPrefSatisfaction(state)
  return {
    fairnessScore: computeSessionFairness(state).total,
    matchCountRange: match.range,
    partnerRepeatPairs: partner.repeat_pairs.length,
    opponentRepeatPairs: opponent.repeat_pairs.length,
    genderSatisfied: gender.satisfied_count,
    genderOpportunities: gender.total_pref_opportunities,
  }
}

async function main() {
  const rounds = Math.max(1, Number(argValue('--rounds', '50')))
  const seeds = Math.max(1, Number(argValue('--seeds', '3')))
  const cachedImpl = argValue('--cached-impl', 'production') as 'production' | 'experimental'
  if (!['production', 'experimental'].includes(cachedImpl)) {
    throw new Error('--cached-impl must be production or experimental')
  }
  const summaryOnly = process.argv.includes('--summary-only')
  const rows: any[] = []
  const finalRows: any[] = []

  for (const template of SCENARIOS) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const config: SimulationConfig = {
        ...template.config,
        rounds,
        seed,
        use_corrector: true,
        scenario_name: template.name,
      }
      const players = generatePlayers(config, seedrandom(String(seed)))
      let baselineState = initState(players, { courts: config.courts, pvna_tolerance: 0.5 })
      let cachedState = initState(players, { courts: config.courts, pvna_tolerance: 0.5 })

      for (let roundNo = 1; roundNo <= rounds; roundNo += 1) {
        const baselineAdjustment = correctForFairness(baselineState)
        const baselineEffectiveState = applyFairnessAdjustment(baselineState, baselineAdjustment)
        const baselineStarted = now()
        const baseline = suggestNextRound(baselineEffectiveState, {
          tier_overrides: baselineAdjustment.tier_overrides,
          partition_cache: false,
        })
        const baselineMs = now() - baselineStarted

        const cachedAdjustment = correctForFairness(cachedState)
        const cachedEffectiveState = applyFairnessAdjustment(cachedState, cachedAdjustment)
        const cachedStarted = now()
        const cached = cachedImpl === 'experimental'
          ? suggestNextRoundExperimental(cachedEffectiveState, {
              tier_overrides: cachedAdjustment.tier_overrides,
              mode: 'cached-production',
            })
          : suggestNextRound(cachedEffectiveState, {
              tier_overrides: cachedAdjustment.tier_overrides,
            })
        const cachedMs = now() - cachedStarted

        const baselineAlternative = baseline.alternatives[0]
        const cachedAlternative = cached.alternatives[0]
        if (!baselineAlternative || !cachedAlternative) break

        const baselineMetrics = metrics(baselineEffectiveState, baseline)
        const cachedMetrics = metrics(cachedEffectiveState, cached)
        rows.push({
          scenario: template.name,
          seed,
          roundNo,
          baselineMs,
          cachedMs,
          speedup: baselineMs > 0 && cachedMs > 0
            ? Number((baselineMs / cachedMs).toFixed(2))
            : null,
          sameTopAlternative: signature(baselineAlternative) === signature(cachedAlternative),
          baseline: baselineMetrics,
          cached: cachedMetrics,
          delta: metricDelta(baselineMetrics, cachedMetrics),
        })

        baselineState = commitRound(baselineState, roundNo, baselineAlternative)
        cachedState = commitRound(cachedState, roundNo, cachedAlternative)
      }

      finalRows.push({
        scenario: template.name,
        seed,
        baseline: finalQuality(baselineState),
        cached: finalQuality(cachedState),
      })
    }
  }

  const avg = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
  const count = (predicate: (row: typeof rows[number]) => boolean) => rows.filter(predicate).length
  const scoreDeltas = rows.map((row) => row.delta.score).filter((value): value is number => value !== null)

  console.log(JSON.stringify({
    modes: {
      baseline: 'production-uncached',
      cached: cachedImpl === 'experimental'
        ? 'experimental-cached-production-best-split'
        : 'production-cached-best-split',
    },
    scenarios: SCENARIOS.map((item) => item.name),
    seeds,
    rounds,
    summary: {
      checkpoints: rows.length,
      timing: {
        baseline: timing(rows.map((row) => row.baselineMs)),
        cached: timing(rows.map((row) => row.cachedMs)),
        speedupAvg: Number(avg(rows.map((row) => row.speedup ?? 0).filter((value) => value > 0)).toFixed(2)),
      },
      quality: {
        scoreBetter: count((row) => (row.delta.score ?? 0) < 0),
        scoreSame: count((row) => (row.delta.score ?? 0) === 0),
        scoreWorse: count((row) => (row.delta.score ?? 0) > 0),
        worstScoreRegression: Number(Math.max(0, ...scoreDeltas).toFixed(2)),
        alternativesRegressed: count((row) => row.delta.alternatives < 0),
        cachedMissing3Alt: count((row) => !row.cached.enough3Alt),
        matchRangeWorse: count((row) => row.delta.matchCountRange > 0),
        partnerRepeatsWorse: count((row) => (row.delta.partnerRepeats ?? 0) > 0),
        opponentRepeatsWorse: count((row) => (row.delta.opponentRepeats ?? 0) > 0),
        pvnaWorse: count((row) => (row.delta.pvnaDiff ?? 0) > 0),
        groupBonusWorse: count((row) => (row.delta.groupBonus ?? 0) < 0),
        groupNewPairsWorse: count((row) => row.delta.groupNewPairs < 0),
        genderPenaltyWorse: count((row) => (row.delta.genderPenalty ?? 0) > 0),
        sameTopAlternative: count((row) => row.sameTopAlternative),
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
      finalQuality: finalRows,
    },
    rows: summaryOnly ? undefined : rows,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
