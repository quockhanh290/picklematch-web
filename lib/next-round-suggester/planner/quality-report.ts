// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { OPPONENT_REPEAT_BUDGET_PER_MATCH } from './objective.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionQualityReport } from './quality-gate.ts'

export type SessionQualityTraceMatch = {
  team_a: [string, string]
  team_b: [string, string]
  warnings?: string[]
  tradeoffs?: Array<{ severity?: number; over_by?: number }>
}

export type SessionQualityTraceRound = {
  eligible_player_ids: string[]
  matches: SessionQualityTraceMatch[]
}

export type PlayerSessionQuality = {
  player_id: string
  matches: number
  rests: number
  max_rest_streak: number
  partner_diversity: number
  opponent_diversity: number
  partner_repeat_exposure: number
  opponent_repeat_exposure: number
  warning_match_exposure: number
  quality_debt: number
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

export function buildSessionQualityReport(options: {
  player_ids: string[]
  pvna_by_player: ReadonlyMap<string, number>
  pvna_tolerance: number
  rounds: SessionQualityTraceRound[]
  feasible_match_count_spread?: number
  mathematical_rest_bound?: number
  operation_errors?: number
  avoidable_incomplete_boards?: number
}) {
  const playerIds = [...new Set(options.player_ids)]
  const knownPlayers = new Set(playerIds)
  const matchCounts = new Map(playerIds.map(id => [id, 0]))
  const restCounts = new Map(playerIds.map(id => [id, 0]))
  const restStreaks = new Map(playerIds.map(id => [id, 0]))
  const maxRestStreaks = new Map(playerIds.map(id => [id, 0]))
  const warningExposure = new Map(playerIds.map(id => [id, 0]))
  const qualityDebt = new Map(playerIds.map(id => [id, 0]))
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  let hardViolations = 0
  let avoidableRestViolations = 0
  let totalTeamGap = 0
  let maxTeamGap = 0
  let teamGapOverTolerance = 0
  let teamGapOverOne = 0
  let totalIntraGap = 0
  let maxIntraGap = 0
  let intraGapOverOne = 0
  let intraGapOverTwo = 0
  let relaxationWarningCount = 0
  let maxRelaxationSeverity = 0
  let totalMatches = 0
  const restBound = options.mathematical_rest_bound ?? 1

  const pvna = (id: string) => Number(options.pvna_by_player.get(id) ?? 0)
  for (const round of options.rounds) {
    const eligible = new Set(round.eligible_player_ids.filter(id => knownPlayers.has(id)))
    const played = new Set<string>()
    for (const match of round.matches) {
      const ids = [...match.team_a, ...match.team_b]
      if (match.team_a.length !== 2 || match.team_b.length !== 2) hardViolations += 1
      if (new Set(ids).size !== 4) hardViolations += 1
      hardViolations += ids.filter(id => !knownPlayers.has(id) || !eligible.has(id)).length
      ids.forEach(id => {
        if (played.has(id)) hardViolations += 1
        played.add(id)
        if (knownPlayers.has(id)) matchCounts.set(id, (matchCounts.get(id) ?? 0) + 1)
      })

      const teamGap = Math.abs(
        pvna(match.team_a[0]) + pvna(match.team_a[1])
        - pvna(match.team_b[0]) - pvna(match.team_b[1]),
      )
      const intraA = Math.abs(pvna(match.team_a[0]) - pvna(match.team_a[1]))
      const intraB = Math.abs(pvna(match.team_b[0]) - pvna(match.team_b[1]))
      const intra = Math.max(intraA, intraB)
      totalMatches += 1
      totalTeamGap += teamGap
      maxTeamGap = Math.max(maxTeamGap, teamGap)
      if (teamGap > options.pvna_tolerance) teamGapOverTolerance += 1
      if (teamGap > 1) teamGapOverOne += 1
      totalIntraGap += intra
      maxIntraGap = Math.max(maxIntraGap, intra)
      if (intra > 1) intraGapOverOne += 1
      if (intra > 2) intraGapOverTwo += 1

      const hasRelaxation = (match.warnings?.length ?? 0) > 0 || (match.tradeoffs?.length ?? 0) > 0
      if (hasRelaxation) {
        relaxationWarningCount += 1
        ids.forEach(id => warningExposure.set(id, (warningExposure.get(id) ?? 0) + 1))
      }
      for (const tradeoff of match.tradeoffs ?? []) {
        maxRelaxationSeverity = Math.max(
          maxRelaxationSeverity,
          Number(tradeoff.over_by ?? tradeoff.severity ?? 0),
        )
      }

      partnerCounts.set(pairKey(match.team_a[0], match.team_a[1]), (partnerCounts.get(pairKey(match.team_a[0], match.team_a[1])) ?? 0) + 1)
      partnerCounts.set(pairKey(match.team_b[0], match.team_b[1]), (partnerCounts.get(pairKey(match.team_b[0], match.team_b[1])) ?? 0) + 1)
      for (const left of match.team_a) for (const right of match.team_b) {
        const key = pairKey(left, right)
        opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      }
      match.team_a.forEach(id => qualityDebt.set(
        id,
        (qualityDebt.get(id) ?? 0)
          + Math.max(0, teamGap - options.pvna_tolerance) * 2
          + Math.max(0, intraA - 1),
      ))
      match.team_b.forEach(id => qualityDebt.set(
        id,
        (qualityDebt.get(id) ?? 0)
          + Math.max(0, teamGap - options.pvna_tolerance) * 2
          + Math.max(0, intraB - 1),
      ))
    }

    for (const id of eligible) {
      const streak = played.has(id) ? 0 : (restStreaks.get(id) ?? 0) + 1
      restStreaks.set(id, streak)
      maxRestStreaks.set(id, Math.max(maxRestStreaks.get(id) ?? 0, streak))
      if (!played.has(id)) restCounts.set(id, (restCounts.get(id) ?? 0) + 1)
      if (streak > restBound) avoidableRestViolations += 1
    }
  }

  const repeatedEvents = (counts: ReadonlyMap<string, number>) => [...counts.values()]
    .reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const partnerRepeats = repeatedEvents(partnerCounts)
  const opponentRepeats = repeatedEvents(opponentCounts)
  const pairExposure = (counts: ReadonlyMap<string, number>, id: string) => [...counts.entries()]
    .filter(([key]) => key.split('|').includes(id))
  const players: PlayerSessionQuality[] = playerIds.map(id => ({
    player_id: id,
    matches: matchCounts.get(id) ?? 0,
    rests: restCounts.get(id) ?? 0,
    max_rest_streak: maxRestStreaks.get(id) ?? 0,
    partner_diversity: pairExposure(partnerCounts, id).length,
    opponent_diversity: pairExposure(opponentCounts, id).length,
    partner_repeat_exposure: pairExposure(partnerCounts, id).reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0),
    opponent_repeat_exposure: pairExposure(opponentCounts, id).reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0),
    warning_match_exposure: warningExposure.get(id) ?? 0,
    quality_debt: qualityDebt.get(id) ?? 0,
  }))
  const activeMatchCounts = players.filter(player => player.matches > 0 || player.rests > 0).map(player => player.matches)
  const debtValues = players.map(player => player.quality_debt)
  const summary: SessionQualityReport = {
    rounds: options.rounds.length,
    matches: totalMatches,
    hard_violations: hardViolations,
    operation_errors: options.operation_errors ?? 0,
    avoidable_incomplete_boards: options.avoidable_incomplete_boards ?? 0,
    avoidable_rest_violations: avoidableRestViolations,
    match_count_spread: activeMatchCounts.length > 0 ? Math.max(...activeMatchCounts) - Math.min(...activeMatchCounts) : 0,
    feasible_match_count_spread: options.feasible_match_count_spread ?? 1,
    max_consecutive_rest: Math.max(0, ...players.map(player => player.max_rest_streak)),
    mathematical_rest_bound: restBound,
    team_gap_over_1: teamGapOverOne,
    intra_gap_over_2: intraGapOverTwo,
    partner_repeats: partnerRepeats,
    player_quality_debt_max: Math.max(0, ...debtValues),
    player_quality_debt_p95: percentile(debtValues, 0.95),
    team_gap_over_0_5: teamGapOverTolerance,
    intra_gap_over_1: intraGapOverOne,
    opponent_repeat_overflow: Math.max(0, opponentRepeats - totalMatches * OPPONENT_REPEAT_BUDGET_PER_MATCH),
    opponent_repeats: opponentRepeats,
    relaxation_warning_count: relaxationWarningCount,
    max_relaxation_severity: maxRelaxationSeverity,
    avg_team_gap: totalMatches > 0 ? totalTeamGap / totalMatches : 0,
    max_team_gap: maxTeamGap,
    avg_intra_gap: totalMatches > 0 ? totalIntraGap / totalMatches : 0,
    max_intra_gap: maxIntraGap,
  }
  return { summary, players }
}
