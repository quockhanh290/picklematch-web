import { deferLowViabilityRequiredIdsForCourt, hasNearLevelPeerInActiveRoster } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'
import type { SessionState } from '../../../lib/next-round-suggester/types'

// one weak owed outlier (rest=0) + strong required peers on the LAST court, plus a busy weak peer elsewhere
function lastCourtState(outlierRest = 0): { state: SessionState; required: string[]; outlier: string } {
  const players = [
    createPlayer('weak', { pvna: 2.0, consecutive_rest: outlierRest, matches_played: 1 }),
    createPlayer('s1', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s2', { pvna: 4.4, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s3', { pvna: 4.6, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s4', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('weakBusy', { pvna: 2.1, consecutive_rest: 0, matches_played: 1 }), // near-level peer, busy
  ]
  const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 3 })
  // mark weakBusy busy (on a live court) — still active roster, not opted_rest/checked_out
  return { state, required: ['weak', 's1', 's2', 's3', 's4'], outlier: 'weak' }
}

describe('hasNearLevelPeerInActiveRoster', () => {
  it('true when an active peer within tolerance exists (even if busy)', () => {
    const { state } = lastCourtState()
    expect(hasNearLevelPeerInActiveRoster('weak', state, 0.5)).toBe(true)
  })
  it('false when the outlier is uniquely weak', () => {
    const players = [
      createPlayer('lone', { pvna: 2.0 }), createPlayer('a', { pvna: 4.5 }),
      createPlayer('b', { pvna: 4.4 }), createPlayer('c', { pvna: 4.6 }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
    expect(hasNearLevelPeerInActiveRoster('lone', state, 0.5)).toBe(false)
  })
})

describe('deferLowViabilityRequiredIdsForCourt — last court', () => {
  it('defers a rest=0 peer-backed outlier on the last court (was previously forced)', () => {
    const { state, required, outlier } = lastCourtState(0)
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...required], availableRequiredIds: [...required],
      busyIds: new Set(['weakBusy']), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).not.toContain(outlier)          // deferred → rests this court
    expect(out.length).toBeGreaterThanOrEqual(3) // still enough to fill four (with a pool player)
  })
  it('does NOT defer a rest>0 outlier (Branch B handles that, not auto-rest)', () => {
    const { state, required, outlier } = lastCourtState(1)
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...required], availableRequiredIds: [...required],
      busyIds: new Set(['weakBusy']), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).toContain(outlier)
  })
  it('does NOT defer when the outlier has no active peer (unavoidable blowout)', () => {
    const players = [
      createPlayer('lone', { pvna: 2.0, consecutive_rest: 0, matches_played: 1 }),
      createPlayer('a', { pvna: 4.5 }), createPlayer('b', { pvna: 4.4 }),
      createPlayer('c', { pvna: 4.6 }), createPlayer('d', { pvna: 4.5 }),
    ]
    const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 3 })
    const req = ['lone', 'a', 'b', 'c', 'd']
    const out = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: [...req], availableRequiredIds: [...req],
      busyIds: new Set(), remainingCourtsInRound: 1, minimumRequiredCount: 0, state,
    })
    expect(out).toContain('lone')
  })
})
