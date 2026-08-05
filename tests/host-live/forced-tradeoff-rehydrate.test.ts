import { mergePersistedSuggestionMetadata } from '../../features/host/session-detail/next-round-v2/preview-consistency'

describe('mergePersistedSuggestionMetadata — forced-court decision rehydration', () => {
  it('hydrates forced_tradeoff + wait_rescue_options from suggestion_metadata onto the row', () => {
    const row = {
      id: 'm1', court_idx: 2, status: 'suggested', team_a: ['a', 'b'], team_b: ['c', 'd'],
      suggestion_metadata: {
        forced_tradeoff: {
          acceptRepeat: { team_a: ['a', 'c'], team_b: ['b', 'd'] },
          acceptImbalance: { team_a: ['a', 'b'], team_b: ['c', 'd'] },
        },
        wait_rescue_options: [{ court_idx: 3, started_at: '2026-08-05T07:00:00Z' }],
      },
    }
    const merged = mergePersistedSuggestionMetadata(row) as typeof row & {
      forced_tradeoff?: { acceptRepeat: unknown; acceptImbalance: unknown }
      wait_rescue_options?: { court_idx: number }[]
    }
    expect(merged.forced_tradeoff?.acceptRepeat).toEqual({ team_a: ['a', 'c'], team_b: ['b', 'd'] })
    expect(merged.wait_rescue_options).toEqual([{ court_idx: 3, started_at: '2026-08-05T07:00:00Z' }])
    // row's own fields still win over metadata (no clobber)
    expect(merged.court_idx).toBe(2)
  })

  it('leaves the fields undefined when suggestion_metadata has none (flag-OFF / clean court)', () => {
    const row = { id: 'm2', court_idx: 0, status: 'suggested', team_a: ['a', 'b'], team_b: ['c', 'd'], suggestion_metadata: null }
    const merged = mergePersistedSuggestionMetadata(row) as { forced_tradeoff?: unknown; wait_rescue_options?: unknown }
    expect(merged.forced_tradeoff).toBeUndefined()
    expect(merged.wait_rescue_options).toBeUndefined()
  })
})
