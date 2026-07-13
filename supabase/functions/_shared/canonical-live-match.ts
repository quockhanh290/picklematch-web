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
