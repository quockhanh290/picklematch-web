import { auditAlternative, type AlternativeAudit } from './alternatives.ts'
import { scoreMatch } from './score.ts'
import type { Match, SessionState, SuggestionAlternative } from './types.ts'

export type ManualSwapAudit = {
  alternative: SuggestionAlternative
  before: AlternativeAudit
  after: AlternativeAudit
  delta_fairness: number
  invalid_matches: number
}

export function buildSwappedAlternative(
  base: SuggestionAlternative,
  state: SessionState,
  fromId: string,
  toId: string,
): { alternative: SuggestionAlternative | null; error?: string } {
  if (fromId === toId) return { alternative: null }

  const nextMatches = base.matches.map(match => ({
    ...match,
    team_a: match.team_a.map(id => id === fromId ? toId : id === toId ? fromId : id) as [string, string],
    team_b: match.team_b.map(id => id === fromId ? toId : id === toId ? fromId : id) as [string, string],
  }))
  const nextResting = base.resting.map(id => id === toId ? fromId : id === fromId ? toId : id)
  const restingSet = new Set(nextResting)
  const allPlaying = new Set(nextMatches.flatMap(match => [...match.team_a, ...match.team_b]))

  if (allPlaying.size !== nextMatches.length * 4) {
    return { alternative: null, error: 'Swap khong hop le: mot nguoi bi trung trong cung vong.' }
  }

  const swapped = {
    ...base,
    matches: nextMatches,
    resting: [...restingSet].filter(id => !allPlaying.has(id)).sort(),
    warnings: [...new Set([...base.warnings, 'MANUAL_SWAP'])],
  }

  return { alternative: rescoreAlternative(swapped, state) }
}

export function auditManualSwap(
  state: SessionState,
  base: SuggestionAlternative,
  fromId: string,
  toId: string,
): ManualSwapAudit | null {
  const result = buildSwappedAlternative(base, state, fromId, toId)
  if (!result.alternative) return null
  const before = auditAlternative(state, base, 0)
  const after = auditAlternative(state, result.alternative, 0)
  return {
    alternative: result.alternative,
    before,
    after,
    delta_fairness: after.fairness_total - before.fairness_total,
    invalid_matches: result.alternative.matches.filter(match => !Number.isFinite(match.score ?? 0)).length,
  }
}

function rescoreAlternative(
  alternative: SuggestionAlternative,
  state: SessionState,
): SuggestionAlternative {
  let totalScore = 0
  let totalStats = emptyMatchStats()
  let hasInvalidMatch = false
  const matches = alternative.matches.map(match => {
    const scored = scoreMatch(match.team_a, match.team_b, state)
    if (!Number.isFinite(scored.score)) hasInvalidMatch = true
    totalScore += Number.isFinite(scored.score) ? scored.score : 9999
    totalStats = addMatchStats(totalStats, scored.stats)
    return {
      ...match,
      score: scored.score,
      stats: scored.stats,
    }
  })

  return {
    ...alternative,
    matches,
    score: totalScore,
    stats: totalStats,
    warnings: hasInvalidMatch
      ? [...new Set([...alternative.warnings, 'MANUAL_SWAP_HARD_GUARD'])]
      : alternative.warnings,
  }
}

function emptyMatchStats(): Match['stats'] {
  return {
    pvna_diff: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
  }
}

function addMatchStats(a: NonNullable<Match['stats']>, b: NonNullable<Match['stats']>): NonNullable<Match['stats']> {
  return {
    pvna_diff: a.pvna_diff + b.pvna_diff,
    partner_repeats: a.partner_repeats + b.partner_repeats,
    opponent_repeats: a.opponent_repeats + b.opponent_repeats,
    group_bonus: a.group_bonus + b.group_bonus,
    gender_pref_penalty: a.gender_pref_penalty + b.gender_pref_penalty,
  }
}
