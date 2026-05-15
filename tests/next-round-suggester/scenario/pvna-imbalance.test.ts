import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState } from '../helpers/factories'

describe('PVNA imbalance scenarios', () => {
  it('falls back to relaxed tolerance when no strict pairing exists', () => {
    const state = createState({
      pvnaTolerance: 0.01,
      players: [
        createPlayer('p1', { pvna: 4.0 }),
        createPlayer('p2', { pvna: 3.8 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.1 }),
      ],
    })

    expect(suggestNextRound(state).alternatives[0].matches).toHaveLength(1)
  })

  it('warns when relaxed tolerance fallback is used', () => {
    const state = createState({
      pvnaTolerance: 0.01,
      players: [
        createPlayer('p1', { pvna: 4.0 }),
        createPlayer('p2', { pvna: 3.8 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.1 }),
      ],
    })

    expect(suggestNextRound(state).alternatives[0].warnings).toContain('PVNA_TOLERANCE_RELAXED')
  })
})
