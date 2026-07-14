export type SocialPlannerMetrics = {
  matches: number
  interOverOne: number
  intraOverTwo: number
  partnerRepeats: number
  opponentRepeats: number
  interOverTolerance: number
  intraOverOne: number
  maxInter: number
  maxIntra: number
  maxProjectedDebt: number
  squaredProjectedDebt: number
  genderPenalty: number
  engineScore: number
}

export type SocialPlannerCaps = Pick<
  SocialPlannerMetrics,
  'partnerRepeats' | 'opponentRepeats' | 'genderPenalty'
>

export const QUALITY_DEBT_BAND = 0.5
export const OPPONENT_REPEAT_BUDGET_PER_MATCH = 2

export function opponentRepeatOverflow(metrics: SocialPlannerMetrics) {
  return Math.max(
    0,
    metrics.opponentRepeats - metrics.matches * OPPONENT_REPEAT_BUDGET_PER_MATCH,
  )
}

export function socialPlannerObjectiveTuple(metrics: SocialPlannerMetrics) {
  return [
    metrics.interOverOne,
    metrics.intraOverTwo,
    metrics.partnerRepeats,
    Math.floor((metrics.maxProjectedDebt + 1e-9) / QUALITY_DEBT_BAND),
    opponentRepeatOverflow(metrics),
    metrics.interOverTolerance,
    metrics.intraOverOne,
    metrics.opponentRepeats,
    metrics.maxProjectedDebt,
    metrics.squaredProjectedDebt,
    metrics.maxInter,
    metrics.maxIntra,
    metrics.genderPenalty,
    metrics.engineScore,
  ]
}

export function isBetterSocialPlan(
  candidate: SocialPlannerMetrics,
  current: SocialPlannerMetrics,
) {
  const candidateTuple = socialPlannerObjectiveTuple(candidate)
  const currentTuple = socialPlannerObjectiveTuple(current)
  for (let index = 0; index < candidateTuple.length; index += 1) {
    if (Math.abs(candidateTuple[index] - currentTuple[index]) <= 1e-9) continue
    return candidateTuple[index] < currentTuple[index]
  }
  return false
}

export function isWithinSocialPlannerCaps(
  candidate: SocialPlannerMetrics,
  caps: SocialPlannerCaps,
) {
  return candidate.partnerRepeats <= caps.partnerRepeats
    && candidate.opponentRepeats <= caps.opponentRepeats
    && candidate.genderPenalty <= caps.genderPenalty
}
