import { repairPayloadBatchBlowoutFromPool } from '../../../lib/next-round-suggester/live-preview'
import type { SessionState, SuggestedMatchPayload, Team } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

// Bimodal owed pool forced onto one rolling court: three low/mid players + one high outlier, which can
// only be a team-total blowout. A near-level filler sits on the bench, and the high outlier keeps a
// near-level peer on the bench so it can be seated balanced next.
const player = (id: string, pvna: number) => createPlayer(id, { pvna, matches_played: 1, consecutive_rest: 1, last_played_round: 0 })

const payload = (courtIdx: number, teamA: Team, teamB: Team, degraded?: string): SuggestedMatchPayload =>
  ({ court_idx: courtIdx, team_a: teamA, team_b: teamB, status: 'suggested', round_no: 2, degraded_reason: degraded } as SuggestedMatchPayload)

const teamGap = (p: SuggestedMatchPayload, state: SessionState) => {
  const sum = (t: Team) => t.reduce((s, id) => s + (state.players.get(id)?.pvna ?? 0), 0)
  return Math.abs(sum(p.team_a) - sum(p.team_b))
}

function buildScenario(options: { highPeerOnBench?: boolean } = {}) {
  const players = [
    player('L1', 2.30), player('L2', 2.40), player('M1', 3.20), player('H1', 4.50), // seated (blowout)
    player('F1', 2.90), player('F2', 3.10),                                         // near-level fillers
    options.highPeerOnBench ? player('H2', 4.55) : player('X2', 3.00),              // H1's peer (or not)
    player('F3', 2.60),
  ]
  return createState({ players, courts: 3, pvnaTolerance: 0.5 })
}
const bench = ['F1', 'F2', 'F3']

describe('repairPayloadBatchBlowoutFromPool', () => {
  const tol = 0.5

  it('swaps the skill-outlier out for a near-level filler to bring a blowout within tolerance', () => {
    const state = buildScenario({ highPeerOnBench: true })
    const payloads = [payload(1, ['L1', 'L2'], ['M1', 'H1'], 'blowout')]
    expect(teamGap(payloads[0], state)).toBeGreaterThan(2.5)

    const repaired = repairPayloadBatchBlowoutFromPool(payloads, state, tol, [...bench, 'H2'])

    expect(teamGap(repaired[0], state)).toBeLessThanOrEqual(tol + 1e-6)
    const seated = [...repaired[0].team_a, ...repaired[0].team_b]
    expect(seated).not.toContain('H1')           // the high outlier was deferred
    expect(seated).toContain('L1')               // the cohesive low majority stayed
    expect(seated).toContain('L2')
    expect(seated).toContain('M1')
  })

  it('defers only the outlier, not the whole owed majority', () => {
    const state = buildScenario({ highPeerOnBench: true })
    const payloads = [payload(1, ['L1', 'L2'], ['M1', 'H1'], 'blowout')]
    const repaired = repairPayloadBatchBlowoutFromPool(payloads, state, tol, [...bench, 'H2'])
    const seated = new Set([...repaired[0].team_a, ...repaired[0].team_b])
    // exactly one original player (H1) was swapped out
    const originals = ['L1', 'L2', 'M1', 'H1']
    expect(originals.filter(id => !seated.has(id))).toEqual(['H1'])
  })

  it('leaves the blowout intact when the outlier would be stranded (no near-level bench peer)', () => {
    const state = buildScenario({ highPeerOnBench: false })  // no ~4.5 peer on bench
    const payloads = [payload(1, ['L1', 'L2'], ['M1', 'H1'], 'blowout')]
    const repaired = repairPayloadBatchBlowoutFromPool(payloads, state, tol, [...bench, 'X2'])
    expect(repaired).toBe(payloads)  // no swap — H1 kept, blowout surfaced by the degraded panel
  })

  it('no-ops when no payload is flagged as a blowout', () => {
    const state = buildScenario({ highPeerOnBench: true })
    const payloads = [payload(1, ['L1', 'L2'], ['M1', 'H1'])]  // same lopsided teams but not flagged
    const repaired = repairPayloadBatchBlowoutFromPool(payloads, state, tol, [...bench, 'H2'])
    expect(repaired).toBe(payloads)
  })

  it('no-ops when the bench is empty', () => {
    const state = buildScenario({ highPeerOnBench: true })
    const payloads = [payload(1, ['L1', 'L2'], ['M1', 'H1'], 'blowout')]
    const repaired = repairPayloadBatchBlowoutFromPool(payloads, state, tol, [])
    expect(repaired).toBe(payloads)
  })
})
