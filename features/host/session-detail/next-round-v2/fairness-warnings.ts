import { detectFairnessIssues, type FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import { sanitizeWarningsForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import { previewStateAfterAlternative } from '@/lib/next-round-suggester/history'
import type { SessionState, SuggestionAlternative } from '@/lib/next-round-suggester/types'

function severityRank(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function warningIdentity(warning: FairnessWarning): string {
  return `${warning.type}:${[...warning.affected_players].sort().join(',')}`
}

function toProjectedWarning(warning: FairnessWarning): FairnessWarning {
  return {
    ...warning,
    type: warning.type.startsWith('projected_') ? warning.type : (`projected_${warning.type}` as FairnessWarning['type']),
    message: `If this round starts: ${warning.message}`,
    suggested_action: warning.suggested_action,
  }
}

export function buildFairnessWarningsForBanner(
  state: SessionState,
  alternative: SuggestionAlternative | null | undefined,
): FairnessWarning[] {
  const current = sanitizeWarningsForHost(detectFairnessIssues(state))
  const currentKeys = new Set(current.map(warningIdentity))
  const projectedState = alternative ? previewStateAfterAlternative(state, alternative) : null
  const projected = projectedState
    ? sanitizeWarningsForHost(detectFairnessIssues(projectedState))
      .filter(warning => !currentKeys.has(warningIdentity(warning)))
      .map(toProjectedWarning)
    : []

  return [...current, ...projected].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity)
    if (severityDiff !== 0) return severityDiff
    return warningIdentity(a).localeCompare(warningIdentity(b))
  })
}
