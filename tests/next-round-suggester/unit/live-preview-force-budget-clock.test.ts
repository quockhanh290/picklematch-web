import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayers, createState } from '../helpers/factories'

// The batch-wide force-rescue budget used to cross the module boundary as an absolute timestamp, so the
// producer and the consumer had to agree on an epoch. They did not: live-preview built it from
// performance.now() while suggest compared it against Date.now(), which expired the budget before the
// search began. A duration cannot carry that disagreement.
describe('force budget', () => {
  it('starves the search when the caller hands over a spent budget', () => {
    const state = createState({ courts: 1, pvnaTolerance: 0.5, players: createPlayers(12) })
    const events: { event: string; detail?: string }[] = []

    const result = suggestNextRound(state, {
      max_alternatives: 3,
      force_budget_ms: 0,
      onInstrumentEvent: event => { events.push(event) },
    })

    expect(result.alternatives).toHaveLength(0)
    expect(events.filter(e => e.event === 'stage_resolved').map(e => e.detail)).toEqual(['none'])
  })

  it('searches normally when the budget still has time on it', () => {
    const state = createState({ courts: 1, pvnaTolerance: 0.5, players: createPlayers(12) })
    const events: { event: string; detail?: string }[] = []

    const result = suggestNextRound(state, {
      max_alternatives: 3,
      force_budget_ms: 1500,
      onInstrumentEvent: event => { events.push(event) },
    })

    expect(result.alternatives.length).toBeGreaterThan(0)
    expect(events.filter(e => e.event === 'stage_resolved').map(e => e.detail)).not.toContain('none')
  })

  it('leaves the live batch its full force-rescue budget', () => {
    const state = createState({ courts: 1, pvnaTolerance: 0.5, players: createPlayers(12) })
    const events: { event: string; detail?: string }[] = []

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: {
        courtIdxs: [0],
        onInstrumentEvent: event => { events.push(event) },
      },
    })

    expect(payloads).toHaveLength(1)
    expect(events.filter(e => e.event === 'stage_resolved').map(e => e.detail)).not.toContain('none')
  })
})
