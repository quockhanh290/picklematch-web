import { normalizeRepairedPayload } from '../../../lib/next-round-suggester/live-preview'
import type { SuggestedMatchPayload } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'

// degraded_reason and rescue_court_idxs are stamped while a court is being filled, before the repair
// passes run. dropStaleDerivedMetadata clears the panel fields when the lineup changes underneath them
// but leaves these two, and normalizeRepairedPayload re-derives the warnings without touching them.
//
// So a court that the blowout repair has just fixed still tells the host it is lopsided, and still
// offers "Chờ Sân X" — waiting for another court to finish so this one can be rescued, when there is
// nothing left to rescue. The host is asked to make a decision about a problem that no longer exists.
//
// This was in the audit's raw findings and never reached the curated table. It also became easier to hit
// today: fixing the 'both' exclusion made the blowout repair act on courts it used to skip.
describe('a repaired court stops claiming it is degraded', () => {
  const balancedState = () => createState({
    courts: 1,
    pvnaTolerance: 0.5,
    players: [
      createPlayer('a1', { pvna: 3.5 }), createPlayer('a2', { pvna: 3.5 }),
      createPlayer('b1', { pvna: 3.5 }), createPlayer('b2', { pvna: 3.5 }),
    ],
  })

  const repairedPayload = (): SuggestedMatchPayload => ({
    court_idx: 0,
    team_a: ['a1', 'a2'],
    team_b: ['b1', 'b2'],
    resting: [],
    // Stamped before the repair, when this court really was lopsided.
    degraded_reason: 'blowout',
    rescue_court_idxs: [2, 3],
    warnings: [],
    tradeoffs: [],
  } as never)

  it('clears the flag once the lineup is no longer lopsided', () => {
    const normalized = normalizeRepairedPayload(repairedPayload(), balancedState(), 0.5)

    expect(normalized.degraded_reason).toBeUndefined()
  })

  it('withdraws the wait-for-another-court offer along with it', () => {
    const normalized = normalizeRepairedPayload(repairedPayload(), balancedState(), 0.5)

    expect(normalized.rescue_court_idxs ?? []).toEqual([])
  })

  it('leaves the flag alone when the lineup really is still lopsided', () => {
    const lopsided = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a1', { pvna: 5.0 }), createPlayer('a2', { pvna: 5.0 }),
        createPlayer('b1', { pvna: 2.0 }), createPlayer('b2', { pvna: 2.0 }),
      ],
    })

    const normalized = normalizeRepairedPayload(repairedPayload(), lopsided, 0.5)

    expect(normalized.degraded_reason).toBe('blowout')
  })
})
