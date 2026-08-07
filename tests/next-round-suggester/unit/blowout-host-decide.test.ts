import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'
import { createPlayer, createState } from '../helpers/factories'
import type { PlayerSessionState, SessionLiveMatchRow, SessionState } from '../../../lib/next-round-suggester/types'

// courts:6 with 5 courts already live THIS round (court_idx 1-5) leaves exactly one open court
// (idx 0) — "last court", remainingCourtsInRound:1 — without the courts:1 pitfall: with courts:1,
// EVERY extra live match reconstructs into its OWN separate logical round (capacity 1), which marks
// every non-participant (including the outlier and its strong partners) as "previous-round-rested" and
// floods availableRequiredIds past the canLetQuotaGuardPickRequiredPool threshold — silently dropping
// the hard MUST_PLAY requirement instead of forcing it. courts:6 with 5 simultaneous live matches stays
// a single logical round (capacity 6 > 5), so requiredForThisCourt correctly resolves to just the
// outlier.
//
// One owed outlier (rest=1, so Branch A's auto-defer does NOT apply) + 4 idle strong players tightly
// clustered (only 3 fit alongside the outlier; the 4th rests this round but stays pool-eligible, so a
// balanced four is findable if the outlier rests instead). A near-level peer for the outlier exists but
// is locked on one of the 5 live courts, so the engine cannot avoid seating a blowout — mirrors
// last-court-outlier-defer's fixture with rest=1.
function blowoutDecideState(): { state: SessionState; liveMatchRows: SessionLiveMatchRow[] } {
  const players: PlayerSessionState[] = [
    createPlayer('weak', { pvna: 2.0, consecutive_rest: 1, matches_played: 1 }),
    createPlayer('s1', { pvna: 4.4, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s2', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s3', { pvna: 4.6, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('s4', { pvna: 4.5, consecutive_rest: 0, matches_played: 1 }),
    createPlayer('weakPeer', { pvna: 2.1, consecutive_rest: 0, matches_played: 1 }),
  ]
  const liveMatchRows: SessionLiveMatchRow[] = []
  for (let court = 1; court <= 5; court += 1) {
    const ids = court === 1
      ? ['weakPeer', 'filler-1-1', 'filler-1-2', 'filler-1-3']
      : [0, 1, 2, 3].map(seat => `filler-${court}-${seat}`)
    ids.slice(court === 1 ? 1 : 0).forEach(id => players.push(createPlayer(id, { pvna: 3.0, matches_played: 1 })))
    liveMatchRows.push({
      id: `live-court-${court}`,
      session_id: 'session-test',
      sequence_no: court,
      round_no: 0,
      court_idx: court,
      status: 'live',
      team_a: [ids[0], ids[1]],
      team_b: [ids[2], ids[3]],
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: '2026-08-05T06:55:00Z',
      started_at: '2026-08-05T07:00:00Z',
      ended_at: null,
    })
  }
  const state = createState({ players, courts: 6, pvnaTolerance: 0.5, currentRound: 0 })
  return { state, liveMatchRows }
}

describe('blowout host-decide (Branch B)', () => {
  afterEach(() => __setQualityCostModelOverrideForTests(null))

  it('rest>0 outlier + peer + balanced alt → seated blowout unchanged + forced_tradeoff kind=blowout attached', () => {
    __setQualityCostModelOverrideForTests(true)
    const { state, liveMatchRows } = blowoutDecideState()
    const payloads = buildSuggestedMatchPayloads({
      count: 1, sessionId: 's', courtCount: 6, state,
      rows: { liveMatchRows, liveStateVersion: null }, completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] }, fairnessWarnings: [],
      playersById: new Map() as any, pvnaTolerance: 0.5, options: { blowoutRescue: true },
    } as any)
    const forced = payloads.find(p => p.forced_tradeoff?.kind === 'blowout')
    expect(forced).toBeDefined()
    expect(forced!.degraded_reason).toBe('blowout')
    // ② = seated blowout, ③ = balanced-rest alternative (different lineup)
    expect(forced!.forced_tradeoff!.acceptRepeat).not.toEqual(forced!.forced_tradeoff!.acceptImbalance)
    expect(typeof forced!.forced_tradeoff!.explanation).toBe('string')
    expect(forced!.forced_tradeoff!.explanation!.length).toBeGreaterThan(0)
    // seated lineup itself is unchanged (Branch B is metadata-only — never alters seating)
    const seated = [...forced!.team_a, ...forced!.team_b]
    expect(seated).toContain('weak')
  })
})
