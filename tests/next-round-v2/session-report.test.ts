import { resolveNextRoundPhase } from '../../features/host/session-detail/next-round-v2/session-report'

describe('resolveNextRoundPhase', () => {
  it('shows recap when the completed target report is open', () => {
    expect(resolveNextRoundPhase({
      showSessionReport: true,
      reportReady: true,
      initialShowReport: false,
      hasActiveRound: false,
    })).toBe('recap')
  })

  it('returns to planning after the host continues beyond the target', () => {
    expect(resolveNextRoundPhase({
      showSessionReport: false,
      reportReady: true,
      initialShowReport: false,
      hasActiveRound: false,
    })).toBe('plan')
  })

  it('does not cover an active match with the report', () => {
    expect(resolveNextRoundPhase({
      showSessionReport: true,
      reportReady: true,
      initialShowReport: false,
      hasActiveRound: true,
    })).toBe('active')
  })
})
