import {
  findCanonicalSuggestedMatch,
  resolveCanonicalRetryMatchId,
} from '../../supabase/functions/_shared/canonical-live-match'

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

// The start handler used to decide this inline with `canonicalMatch?.id !== requestedMatchId`, which is
// true when canonicalMatch is null — and the next line then read `canonicalMatch.id`. A host tapping
// Start on a card whose lineup had been re-suggested got "Cannot read properties of null (reading 'id')"
// and a court that would not start. Deciding it here means the null can no longer reach a dereference.
describe('resolveCanonicalRetryMatchId', () => {
  const rows = [
    match({ id: 'old', status: 'cancelled' }),
    match({ id: 'new', status: 'suggested', team_a: ['d', 'a'], team_b: ['b', 'c'] }),
  ]

  it('returns the replacement id when the lineup was re-suggested unchanged', () => {
    expect(resolveCanonicalRetryMatchId('old', rows)).toBe('new')
  })

  it('returns null when the replacement seats a DIFFERENT lineup — the flicker case', () => {
    const different = [
      match({ id: 'old', status: 'cancelled' }),
      match({ id: 'new', status: 'suggested', team_a: ['x', 'y'], team_b: ['z', 'w'] }),
    ]
    expect(resolveCanonicalRetryMatchId('old', different)).toBeNull()
  })

  it('returns null when the requested row is gone entirely', () => {
    expect(resolveCanonicalRetryMatchId('missing', rows)).toBeNull()
  })

  it('returns null when the requested row is already the current suggestion', () => {
    expect(resolveCanonicalRetryMatchId('new', rows)).toBeNull()
  })

  it('returns null for an empty table rather than throwing', () => {
    expect(resolveCanonicalRetryMatchId('old', [])).toBeNull()
  })
})
