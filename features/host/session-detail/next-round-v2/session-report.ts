export type NextRoundPhase = 'plan' | 'active' | 'recap'

export function resolveNextRoundPhase({
  showSessionReport,
  reportReady,
  initialShowReport,
  hasActiveRound,
}: {
  showSessionReport: boolean
  reportReady: boolean
  initialShowReport: boolean
  hasActiveRound: boolean
}): NextRoundPhase {
  if (showSessionReport && (reportReady || initialShowReport) && !hasActiveRound) return 'recap'
  return hasActiveRound ? 'active' : 'plan'
}
