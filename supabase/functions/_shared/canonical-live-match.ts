type LiveMatchIdentity = {
  id: string
  court_idx: number | null
  team_a: string[]
  team_b: string[]
  status: string
}

function sortedPlayerIds(match: Pick<LiveMatchIdentity, 'team_a' | 'team_b'>) {
  return [...match.team_a, ...match.team_b].sort()
}

export function findCanonicalSuggestedMatch(
  requested: LiveMatchIdentity,
  matches: LiveMatchIdentity[],
) {
  if (requested.status === 'suggested') return requested
  if (requested.status !== 'cancelled') return null

  const requestedPlayers = sortedPlayerIds(requested)
  return matches.find(candidate => {
    if (candidate.status !== 'suggested' || candidate.court_idx !== requested.court_idx) return false
    const candidatePlayers = sortedPlayerIds(candidate)
    return candidatePlayers.length === requestedPlayers.length
      && candidatePlayers.every((playerId, index) => playerId === requestedPlayers[index])
  }) ?? null
}

/**
 * Which match id a rejected start should be retried against, or null for "do not retry".
 *
 * The start handler used to inline this as `canonicalMatch?.id !== requestedMatchId` and then read
 * `canonicalMatch.id` in the body — but `?.` makes the guard TRUE precisely when the value is null, so
 * the null reached the dereference. A host tapping Start on a card whose lineup had been re-suggested
 * saw "Cannot read properties of null (reading 'id')" and a court that would not start.
 *
 * Returning an id-or-null keeps the null from ever reaching a property access.
 */
export function resolveCanonicalRetryMatchId(
  requestedMatchId: string,
  matches: LiveMatchIdentity[],
): string | null {
  const requested = matches.find(candidate => candidate.id === requestedMatchId)
  if (!requested) return null
  const canonical = findCanonicalSuggestedMatch(requested, matches)
  if (!canonical || canonical.id === requestedMatchId) return null
  return canonical.id
}
