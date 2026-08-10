import { normalizeRepairedPayload } from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// docs/POST_PASS_INVENTORY.md lists this as the only pass that re-derives quality warnings from the
// lineup actually being persisted, and as having no test. Seven post-passes are about to be merged into
// one optimizer; a pass with no test can be dropped in the merge while the suite stays green, and the
// symptom would be the host reading a warning about a lineup the repairs already replaced.
//
// Both directions matter, because the pass strips the quality warnings before recomputing them: a
// warning that no longer applies has to go, and one that now applies has to appear.
describe('normalizing a repaired payload', () => {
  const state = () => createState({
    courts: 1,
    pvnaTolerance: 0.5,
    players: [
      createPlayer('even-1', { pvna: 3.0 }),
      createPlayer('even-2', { pvna: 3.0 }),
      createPlayer('even-3', { pvna: 3.0 }),
      createPlayer('even-4', { pvna: 3.0 }),
      createPlayer('strong-1', { pvna: 4.0 }),
      createPlayer('strong-2', { pvna: 4.0 }),
    ],
  })

  const payload = (
    teamA: [string, string],
    teamB: [string, string],
    warnings: string[] = [],
  ): SuggestedMatchPayload => ({
    court_idx: 0, team_a: teamA, team_b: teamB, resting: [], round_no: 1, warnings, tradeoffs: [],
  } as unknown as SuggestedMatchPayload)

  it('drops a tolerance warning the repaired lineup no longer earns', () => {
    const normalized = normalizeRepairedPayload(
      payload(['even-1', 'even-2'], ['even-3', 'even-4'], ['PVNA_TOLERANCE_RELAXED']),
      state(),
      0.5,
    )

    expect(normalized.warnings ?? []).not.toContain('PVNA_TOLERANCE_RELAXED')
  })

  it('adds the tolerance warning when the repaired lineup earns one', () => {
    const normalized = normalizeRepairedPayload(
      payload(['even-1', 'even-2'], ['strong-1', 'strong-2']),
      state(),
      0.5,
    )

    expect(normalized.warnings ?? []).toContain('PVNA_TOLERANCE_RELAXED')
  })

  it('reports how far past tolerance the persisted lineup actually is', () => {
    const normalized = normalizeRepairedPayload(
      payload(['even-1', 'even-2'], ['strong-1', 'strong-2']),
      state(),
      0.5,
    )
    const relaxed = (normalized.tradeoffs ?? []).find(t => t.type === 'pvna_tolerance_relaxed')

    // Teams are 6.0 against 8.0, so the gap is 2.0 and it sits 1.5 past a 0.5 tolerance.
    expect(relaxed?.over_by).toBeCloseTo(1.5, 5)
  })

  it('leaves warnings it does not own untouched', () => {
    const normalized = normalizeRepairedPayload(
      payload(['even-1', 'even-2'], ['even-3', 'even-4'], ['LIVE_RECYCLE_ABSOLUTE_RELAXED']),
      state(),
      0.5,
    )

    expect(normalized.warnings ?? []).toContain('LIVE_RECYCLE_ABSOLUTE_RELAXED')
  })
})
