import { repairPayloadBatchBlowoutFromPool } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'

// repairPayloadBatchBlowoutFromPool selects the courts it will repair with
// `degraded_reason !== 'blowout' -> skip`. But degraded_reason is 'both' whenever a court is blown out
// AND repeat-heavy (live-preview.ts:4085), so the courts in the worst shape are the exact ones the
// blowout repair refuses to look at.
//
// Elsewhere the same file gets this right — the repeat side tests `=== 'repeat' || === 'both'`
// (live-preview.ts:5408) — which is what makes the exact match here read as an oversight rather than a
// decision.
//
// Same board twice, labelled two ways. A court that is blown out is blown out; adding a repeat problem
// on top cannot make it less worth repairing.
describe('the blowout repair does not skip a court that is also repeat-heavy', () => {
  // Numbers chosen so a single bench swap actually satisfies every guard the pass applies: the swap must
  // shrink the gap, keep both teams' internal spread within 1.0, leave the outgoing player a near-level
  // peer on the bench, and take the seat from someone no more owed a turn than the incoming player.
  const buildState = () => {
    const seated = [
      createPlayer('s1', { pvna: 4.0 }), createPlayer('s2', { pvna: 4.0 }),
      createPlayer('s3', { pvna: 2.5 }), createPlayer('s4', { pvna: 2.5 }),
    ]
    const bench = [
      createPlayer('b1', { pvna: 3.0 }),  // the swap in: closes the gap without widening either team
      createPlayer('b2', { pvna: 3.0 }),
      createPlayer('b3', { pvna: 4.0 }),  // keeps a near-level peer for whoever leaves at 4.0
      createPlayer('b4', { pvna: 2.5 }),
    ]
    return createState({ courts: 1, pvnaTolerance: 0.5, players: [...seated, ...bench] })
  }

  const payloadWith = (reason: 'blowout' | 'both'): SuggestedMatchPayload => ({
    court_idx: 0,
    team_a: ['s1', 's2'],
    team_b: ['s3', 's4'],
    resting: [],
    degraded_reason: reason,
  } as never)

  const lineupAfterRepair = (reason: 'blowout' | 'both') => {
    const state = buildState()
    const repaired = repairPayloadBatchBlowoutFromPool(
      [payloadWith(reason)], state, 0.5, ['b1', 'b2', 'b3', 'b4'],
    )
    return [...repaired[0].team_a, ...repaired[0].team_b].sort().join('+')
  }

  const untouched = ['s1', 's2', 's3', 's4'].sort().join('+')

  it('repairs a court marked blowout', () => {
    // Control: proves the scenario is repairable at all, so the next case is about the label only.
    expect(lineupAfterRepair('blowout')).not.toBe(untouched)
  })

  it('repairs the same court when it is marked both', () => {
    expect(lineupAfterRepair('both')).not.toBe(untouched)
  })
})
