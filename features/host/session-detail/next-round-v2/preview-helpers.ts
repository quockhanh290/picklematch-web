import type { PlayerSessionState, SessionLiveMatchRow, SessionState } from '@/lib/next-round-suggester/types'
import type { SuggestedLiveMatchRow } from './preview'

export const getSuggestedMatchSignature = (match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>) => [
  ...match.team_a.map(String).sort(),
  ...match.team_b.map(String).sort(),
].join('|')

export function applyPairIncrement(
  players: Map<string, PlayerSessionState>,
  playerAId: string,
  playerBId: string,
  type: 'partner' | 'opponent',
): void {
  const playerA = players.get(playerAId)
  const playerB = players.get(playerBId)
  if (playerA) {
    const partnerCounts = new Map(playerA.partner_counts)
    const opponentCounts = new Map(playerA.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
    players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
  if (playerB) {
    const partnerCounts = new Map(playerB.partner_counts)
    const opponentCounts = new Map(playerB.opponent_counts)
    const counts = type === 'partner' ? partnerCounts : opponentCounts
    counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
    players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
  }
}

export function swapPlayersInSuggestedMatch(match: SuggestedLiveMatchRow, fromId: string, toId: string): SuggestedLiveMatchRow {
  const replaceInTeam = (team: string[]) => team.map(playerId => {
    if (playerId === fromId) return toId
    if (playerId === toId) return fromId
    return playerId
  }) as [string, string]

  const teamA = replaceInTeam(match.team_a)
  const teamB = replaceInTeam(match.team_b)
  const toWasResting = (match.resting ?? []).includes(toId)
  const restingBase = toWasResting
    ? [...(match.resting ?? []).filter(playerId => playerId !== toId), fromId]
    : (match.resting ?? [])
  const playingAfter = new Set([...teamA, ...teamB])
  const resting = [...new Set(restingBase)].filter(playerId => !playingAfter.has(playerId))

  return {
    ...match,
    team_a: teamA,
    team_b: teamB,
    resting,
  }
}
