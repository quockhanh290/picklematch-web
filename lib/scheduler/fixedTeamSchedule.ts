// Kept for future Round Robin scheduling — intentionally not wired yet.
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import {
  buildTeamsMap,
  getFixedTeamScoreWeights,
  scoreFixedTeamAssignments,
  type FixedTeamOptimizationProfile,
} from './scoring'

export type FixedTeamScheduledMatch = {
  teamA: string[]
  teamB: string[]
  teamANo: number
  teamBNo: number
  rotation: number
  court: number
}

export type FixedTeamScheduleDraft = {
  matches: FixedTeamScheduledMatch[]
  players: ArrangementPlayer[]
  quality: {
    runtimeMs: number
    timedOut: boolean
    fallbackUsed: boolean
    pairingScore: number
  }
}

export function buildFixedTeamScheduleDraft(
  players: ArrangementPlayer[],
  courtCount = 1,
  profile: FixedTeamOptimizationProfile = 'balanced'
): FixedTeamScheduleDraft {
  const startedAt = Date.now()
  const teamsMap = buildTeamsMap(players)
  const teamIds = Array.from(teamsMap.entries())
    .filter(([, teamPlayers]) => teamPlayers.length === 2)
    .map(([teamNo]) => teamNo)
    .sort((a, b) => a - b)

  const effectiveCourts = Math.min(
    Math.max(1, Math.floor(courtCount || 1)),
    Math.max(1, Math.floor(teamIds.length / 2))
  )
  const schedulingTeams = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, 0]
  const rounds = Math.max(0, schedulingTeams.length - 1)
  const matches: FixedTeamScheduledMatch[] = []
  const circle = [...schedulingTeams]
  let rotation = 1

  for (let round = 0; round < rounds; round++) {
    const roundMatches: Omit<FixedTeamScheduledMatch, 'rotation' | 'court'>[] = []

    for (let index = 0; index < circle.length / 2; index++) {
      const teamANo = circle[index]
      const teamBNo = circle[circle.length - 1 - index]
      if (teamANo === 0 || teamBNo === 0) continue

      roundMatches.push({
        teamA: (teamsMap.get(teamANo) || []).map(player => String(player.id)),
        teamB: (teamsMap.get(teamBNo) || []).map(player => String(player.id)),
        teamANo,
        teamBNo,
      })
    }

    for (let start = 0; start < roundMatches.length; start += effectiveCourts) {
      roundMatches.slice(start, start + effectiveCourts).forEach((match, courtIndex) => {
        matches.push({ ...match, rotation, court: courtIndex + 1 })
      })
      rotation++
    }

    const last = circle.pop()
    if (last != null) circle.splice(1, 0, last)
  }

  const scheduledPlayerIds = new Set<string>()
  matches.forEach(match => {
    match.teamA.forEach(id => scheduledPlayerIds.add(id))
    match.teamB.forEach(id => scheduledPlayerIds.add(id))
  })

  return {
    matches,
    players: players
      .filter(player => scheduledPlayerIds.has(String(player.id)))
      .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))),
    quality: {
      runtimeMs: Date.now() - startedAt,
      timedOut: false,
      fallbackUsed: false,
      pairingScore: scoreFixedTeamAssignments(players, teamIds.length, getFixedTeamScoreWeights(profile)),
    },
  }
}
