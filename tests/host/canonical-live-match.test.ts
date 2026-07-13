import { findCanonicalSuggestedMatch } from '../../supabase/functions/_shared/canonical-live-match'

const match = (overrides: Partial<{
  id: string
  court_idx: number | null
  team_a: string[]
  team_b: string[]
  status: string
}> = {}) => ({
  id: 'old',
  court_idx: 2,
  team_a: ['a', 'b'],
  team_b: ['c', 'd'],
  status: 'cancelled',
  ...overrides,
})

describe('findCanonicalSuggestedMatch', () => {
  it('resolves a cancelled row to the current suggestion with the same court and players', () => {
    const requested = match()
    const canonical = match({
      id: 'new',
      team_a: ['d', 'a'],
      team_b: ['b', 'c'],
      status: 'suggested',
    })

    expect(findCanonicalSuggestedMatch(requested, [requested, canonical])).toBe(canonical)
  })

  it('does not redirect to a different lineup or court', () => {
    const requested = match()
    expect(findCanonicalSuggestedMatch(requested, [
      requested,
      match({ id: 'different-player', team_b: ['c', 'x'], status: 'suggested' }),
      match({ id: 'different-court', court_idx: 3, status: 'suggested' }),
    ])).toBeNull()
  })

  it('does not redirect live or completed requests', () => {
    const requested = match({ status: 'live' })
    expect(findCanonicalSuggestedMatch(requested, [
      requested,
      match({ id: 'new', status: 'suggested' }),
    ])).toBeNull()
  })
})
