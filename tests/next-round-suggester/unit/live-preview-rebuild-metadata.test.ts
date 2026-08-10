import { rebuildDerivedMetadataForSeatedLineup } from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// The panel is derived inside the per-court fill loop, and the repair and joint passes then rewrite the
// lineup under it — 935 of 1160 payloads, measured. dropStaleDerivedMetadata notices the mismatch and
// throws the panel away, which is why only 21 of 458 ever reached the host.
//
// Two cheaper repairs were measured and rejected. Re-pointing at a choice that already describes the
// seated lineup covers 33 of 482: the passes usually land on a lineup that was never a candidate.
// Keeping the pre-pass alternatives and dropping the infeasible ones is worse — joint repartition moves
// players BETWEEN courts, so 359 of 482 payloads have no surviving alternative at all.
//
// What always survives is the seated four. The other ways to split those same players need no search,
// cannot conflict with another court, and change who partners whom, so the repeat axis stays live.
// Measured reach: ~17% of courts have a split that beats the seated one, ~12% once cosmetic differences
// are filtered out. It cannot change WHO plays, only who partners whom.
describe('rebuilding derived metadata from the seated lineup', () => {
  const payloadFor = (teamA: [string, string], teamB: [string, string]): SuggestedMatchPayload => ({
    court_idx: 0,
    team_a: teamA,
    team_b: teamB,
    resting: [],
    round_no: 1,
  } as unknown as SuggestedMatchPayload)

  // Two strong, two weak. Seating strong-with-strong makes the teams 1.8 apart, well past the 0.5
  // tolerance; splitting them across teams costs a little intra-team spread and fixes the gap. That is
  // the shape the post-passes leave behind, and the choice worth handing the host.
  const state = () => createState({
    courts: 1,
    pvnaTolerance: 0.5,
    players: [
      createPlayer('strong-1', { pvna: 4.0 }),
      createPlayer('strong-2', { pvna: 3.9 }),
      createPlayer('weak-1', { pvna: 3.1 }),
      createPlayer('weak-2', { pvna: 3.0 }),
    ],
  })

  const lopsidedA: [string, string] = ['strong-1', 'strong-2']
  const lopsidedB: [string, string] = ['weak-1', 'weak-2']

  it('offers the split that fixes a lineup the passes left over tolerance', () => {
    const rebuilt = rebuildDerivedMetadataForSeatedLineup(payloadFor(lopsidedA, lopsidedB), state(), 0.5)

    expect(rebuilt.tradeoff_choices?.length ?? 0).toBeGreaterThan(1)
  })

  it('points the recommendation at the lineup being persisted, not at a discarded one', () => {
    const rebuilt = rebuildDerivedMetadataForSeatedLineup(payloadFor(lopsidedA, lopsidedB), state(), 0.5)
    const recommended = rebuilt.tradeoff_choices
      ?.find(choice => choice.id === rebuilt.recommended_tradeoff_choice)
    const match = recommended?.alternative.matches[0]

    expect(match).toBeDefined()
    expect([...match!.team_a].sort()).toEqual([...lopsidedA].sort())
  })

  it('only ever offers the four players already on the court', () => {
    const rebuilt = rebuildDerivedMetadataForSeatedLineup(payloadFor(lopsidedA, lopsidedB), state(), 0.5)

    for (const choice of rebuilt.tradeoff_choices ?? []) {
      const match = choice.alternative.matches[0]
      expect(new Set([...match.team_a, ...match.team_b]))
        .toEqual(new Set(['strong-1', 'strong-2', 'weak-1', 'weak-2']))
    }
  })

  // Every foursome has three splits and they almost always differ a little — measured, 1152 of 1160.
  // Showing a panel for a rounding difference would turn a decision point into noise, so a split has to
  // beat the seated one by a visible margin before it is offered at all.
  it('stays quiet when no split is meaningfully better than the one seated', () => {
    const balanced = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.05 }),
        createPlayer('p3', { pvna: 3.1 }),
        createPlayer('p4', { pvna: 3.15 }),
      ],
    })
    const rebuilt = rebuildDerivedMetadataForSeatedLineup(
      payloadFor(['p1', 'p2'], ['p3', 'p4']),
      balanced,
      0.5,
    )

    expect(rebuilt.tradeoff_choices).toBeUndefined()
  })
})
