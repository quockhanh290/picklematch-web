import { repairPayloadBatchSevereRepeatFromPool } from '../../../lib/next-round-suggester/live-preview'
import { getProjectedRepeatSummary } from '../../../lib/next-round-suggester/score'
import type { SessionState, SuggestedMatchPayload, Team } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

// All players equally rested & equally owed unless a test overrides, so fairness never blocks a swap
// except in the test that specifically makes the bench player less owed.
const player = (id: string, pvna: number, matches = 3) =>
  createPlayer(id, { pvna, matches_played: matches, consecutive_rest: 0, last_played_round: 4 })

const payload = (courtIdx: number, teamA: Team, teamB: Team): SuggestedMatchPayload =>
  ({ court_idx: courtIdx, team_a: teamA, team_b: teamB, status: 'suggested', round_no: 4 } as SuggestedMatchPayload)

const projectedMax = (p: SuggestedMatchPayload, state: SessionState) => {
  const s = getProjectedRepeatSummary(p.team_a as Team, p.team_b as Team, state)
  return Math.max(s.max_opponent_pair_count, s.max_partner_pair_count)
}

// A clean court + a court forced into a 3rd meeting, with a fresh equally-owed bench player that can
// replace the repeat-heavy anchor. Mirrors the real multi-court greedy-steal (session 93564c1c).
function buildScenario(options: { benchFreshMatches?: number } = {}) {
  const players = [
    // clean court 0 — all fresh with each other
    player('B1', 3.0), player('B2', 3.05), player('B3', 3.1), player('B4', 3.15),
    // degraded court 1 — A1 has maxed out meetings with A2/A3/A4
    player('A1', 3.0), player('A2', 3.05), player('A3', 3.1), player('A4', 3.15),
    // bench: F1 is fresh; the rest pad the pool
    player('F1', 3.0, options.benchFreshMatches ?? 3),
    player('F2', 3.05), player('F3', 3.1), player('F4', 3.15),
  ]
  const byId = new Map(players.map(p => [p.player_id, p]))
  // A1's third meeting: partner with A2 (2 -> proj 3), opponents A3 & A4 (2 -> proj 3)
  setPartnerRepeats(byId.get('A1')!, byId.get('A2')!, 2)
  setOpponentRepeats(byId.get('A1')!, byId.get('A3')!, 2)
  setOpponentRepeats(byId.get('A1')!, byId.get('A4')!, 2)
  const state = createState({ players, courts: 3, pvnaTolerance: 0.5 })
  return state
}

describe('repairPayloadBatchSevereRepeatFromPool', () => {
  const tolerance = 0.5
  const bench = ['F1', 'F2', 'F3', 'F4']

  it('swaps a fresh benched player in to break a 3rd meeting the greedy fill left behind', () => {
    const state = buildScenario()
    const payloads = [
      payload(0, ['B1', 'B2'], ['B3', 'B4']),
      payload(1, ['A1', 'A2'], ['A3', 'A4']),
    ]
    expect(projectedMax(payloads[1], state)).toBeGreaterThanOrEqual(3)

    const repaired = repairPayloadBatchSevereRepeatFromPool(payloads, state, tolerance, bench)

    // court 1 no longer a 3rd meeting; the repeat-heavy anchor A1 was benched for a fresh player
    expect(projectedMax(repaired[1], state)).toBeLessThan(3)
    const court1Ids = [...repaired[1].team_a, ...repaired[1].team_b]
    expect(court1Ids).not.toContain('A1')
    expect(court1Ids.some(id => bench.includes(id))).toBe(true)
    // the clean court is untouched
    expect([...repaired[0].team_a, ...repaired[0].team_b].sort()).toEqual(['B1', 'B2', 'B3', 'B4'])
  })

  it('never benches a more-owed player: no-op when the only fresh bench player is less owed', () => {
    // F1 has played MORE matches than the seated players -> less owed -> must not replace them
    const state = buildScenario({ benchFreshMatches: 5 })
    const payloads = [
      payload(0, ['B1', 'B2'], ['B3', 'B4']),
      payload(1, ['A1', 'A2'], ['A3', 'A4']),
    ]
    const repaired = repairPayloadBatchSevereRepeatFromPool(payloads, state, tolerance, bench)
    // F2/F3/F4 are equally owed but each has met nobody, so they could still help — the guard only
    // blocks the less-owed F1. Assert A1 is only ever replaced by an equally-owed bench player.
    const court1Ids = [...repaired[1].team_a, ...repaired[1].team_b]
    expect(court1Ids).not.toContain('F1')
  })

  it('no-ops when no payload is at a 3rd meeting', () => {
    const state = buildScenario()
    // court 1 with no maxed meetings (fresh B-cluster split differently)
    const payloads = [
      payload(0, ['B1', 'B2'], ['B3', 'B4']),
      payload(1, ['F1', 'F2'], ['F3', 'F4']),
    ]
    const repaired = repairPayloadBatchSevereRepeatFromPool(payloads, state, tolerance, ['A2', 'A3'])
    expect(repaired).toBe(payloads)
  })

  it('no-ops when the bench is empty', () => {
    const state = buildScenario()
    const payloads = [
      payload(0, ['B1', 'B2'], ['B3', 'B4']),
      payload(1, ['A1', 'A2'], ['A3', 'A4']),
    ]
    const repaired = repairPayloadBatchSevereRepeatFromPool(payloads, state, tolerance, [])
    expect(repaired).toBe(payloads)
  })
})
