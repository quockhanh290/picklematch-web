import { buildRoundRobinDoublesScheduleAsync } from '@/lib/roundRobinSchedulerClient'
import type { RoundRobinSchedule, SchedulePriority } from '@/lib/roundRobinScheduler'

export type GeneratedMatch = {
  teamA: string[]
  teamB: string[]
  teamANo?: number
  teamBNo?: number
  rotation?: number
  court?: number
  sitterId?: string
}

export type ScheduleModeOption = 'full' | 'limited'

export function computeEffectiveCourts(playerCount: number, requestedCourtCount: number): number {
  return Math.min(Math.max(1, Math.floor(requestedCourtCount || 1)), Math.floor(playerCount / 4))
}

export function sortPlayersForSchedule<P extends { id: string | number; name: string }>(players: P[]): P[] {
  return [...players].sort((a, b) =>
    a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))
  )
}

export type FixedScheduleInput = {
  playerIds: string[]
  courtCount: number
  mode: ScheduleModeOption
  minGamesPerPlayer: number
  priority: SchedulePriority
}

export type FixedScheduleResult = {
  matches: GeneratedMatch[]
  quality: RoundRobinSchedule['quality']
  courtsPerRound: number
}

export async function generateFixedSchedule(input: FixedScheduleInput): Promise<FixedScheduleResult> {
  const generated = await buildRoundRobinDoublesScheduleAsync(
    input.playerIds,
    input.courtCount,
    undefined,
    input.mode === 'limited'
      ? { minGamesPerPlayer: input.minGamesPerPlayer, priority: input.priority, maxRuntimeMs: 2_000 }
      : { priority: 'balanced', maxRuntimeMs: 1_500 }
  )
  const matches: GeneratedMatch[] = generated.matches.map(match => ({
    teamA: match.teamA,
    teamB: match.teamB,
    rotation: match.rotation,
    court: match.court,
    sitterId: match.sitterIds.join(',')
  }))
  return { matches, quality: generated.quality, courtsPerRound: generated.courtsPerRound }
}

export type RoundRobinRoundPlayer = {
  id: string
  checkInStatus?: string | null
}

export type RoundRobinRoundInput<P extends RoundRobinRoundPlayer> = {
  activePlayers: P[]
  busyPlayerIds: Set<string> | string[]
  pendingMatches: GeneratedMatch[]
  matchesPlayed: Map<string, number>
  metMap: Map<string, Set<string>>
  partnerMap: Map<string, Set<string>>
  rng?: () => number
}

export type RoundRobinRoundResult =
  | { status: 'not_enough_available_players' }
  | { status: 'match_gap_exceeded' }
  | { status: 'ok'; match: GeneratedMatch; sittingOutPlayerIds: string[] }

export function generateRoundRobinRound<P extends RoundRobinRoundPlayer>(
  input: RoundRobinRoundInput<P>
): RoundRobinRoundResult {
  const { activePlayers, pendingMatches, matchesPlayed, metMap, partnerMap } = input
  const rng = input.rng ?? Math.random
  const busyFromDb = input.busyPlayerIds instanceof Set ? input.busyPlayerIds : new Set(input.busyPlayerIds)

  // 1. Identify who is TRULY available
  const alreadyPendingIds = new Set(pendingMatches.flatMap(m => [
    ...m.teamA.map(pid => String(pid)),
    ...m.teamB.map(pid => String(pid))
  ]))

  const trulyAvailable = activePlayers.filter(p => {
    const sid = String(p.id)
    return !busyFromDb.has(sid) && !alreadyPendingIds.has(sid)
  })

  if (trulyAvailable.length < 4) {
    return { status: 'not_enough_available_players' }
  }

  // 2. Projected Matches Calculation
  const projectedMatches = new Map<string, number>()
  activePlayers.forEach(p => projectedMatches.set(String(p.id), matchesPlayed.get(String(p.id)) ?? 0))

  pendingMatches.forEach(m => {
    [...m.teamA, ...m.teamB].forEach(pid => {
      const sid = String(pid)
      if (projectedMatches.has(sid)) {
        projectedMatches.set(sid, (projectedMatches.get(sid) ?? 0) + 1)
      }
    })
  })

  // 3. Hard Match-Gap Filter (Priority #1)
  const checkedInPlayers = activePlayers.filter(p => p.checkInStatus === 'checked_in')
  const referenceGroup = checkedInPlayers.length > 0 ? checkedInPlayers : activePlayers
  const allProjectedCounts = referenceGroup.map(p => projectedMatches.get(String(p.id)) ?? 0)
  const globalMinMatches = Math.min(...allProjectedCounts)

  const allowedByMatch = trulyAvailable.filter(p => {
    const pCount = projectedMatches.get(String(p.id)) ?? 0
    return pCount <= globalMinMatches + 1
  })

  if (allowedByMatch.length < 4) {
    return { status: 'match_gap_exceeded' }
  }

  // 4. Secondary Sorting: Prioritize Encounter Balance (Soft Constraint)
  const allMetCounts = referenceGroup.map(p => metMap.get(String(p.id))?.size ?? 0)
  const globalMinMet = Math.min(...allMetCounts)

  const sortedAllowed = [...allowedByMatch].sort((a, b) => {
    const sA = String(a.id); const sB = String(b.id)

    // Tier 1: Matches Played (Lower is better)
    const countA = projectedMatches.get(sA) ?? 0
    const countB = projectedMatches.get(sB) ?? 0
    if (countA !== countB) return countA - countB

    // Tier 2: Encounter Gap (If someone is already >2 ahead of the minimum, they get lower priority)
    const metA = metMap.get(sA)?.size ?? 0
    const metB = metMap.get(sB)?.size ?? 0
    const isOverA = metA > globalMinMet + 2
    const isOverB = metB > globalMinMet + 2
    if (isOverA !== isOverB) return isOverA ? 1 : -1

    // Tier 3: Absolute number of encounters
    if (metA !== metB) return metA - metB

    return rng() - 0.5
  })

  // Pick the most urgent seed
  const seedPlayer = sortedAllowed[0]
  const others = sortedAllowed.slice(1)

  // We want to pick 3 people from 'others' who have NOT met seedPlayer
  const seedMet = metMap.get(String(seedPlayer.id))
  const notMetOthers = others.filter(o => !seedMet?.has(String(o.id)))
  const metOthers = others.filter(o => seedMet?.has(String(o.id)))

  // Take as many as possible from notMetOthers, fill the rest from metOthers
  const finalFour = [seedPlayer, ...notMetOthers.slice(0, 3)]
  if (finalFour.length < 4) {
    finalFour.push(...metOthers.slice(0, 4 - finalFour.length))
  }

  let bestMatch: GeneratedMatch = { teamA: [], teamB: [] }
  let lowestMatchScore = Infinity

  // Try 200 combinations within these 4 specific people to find the best teams
  for (let i = 0; i < 200; i++) {
    const shuffle = [...finalFour].sort(() => rng() - 0.5)
    const teamA = [String(shuffle[0].id), String(shuffle[1].id)]
    const teamB = [String(shuffle[2].id), String(shuffle[3].id)]

    let score = 0
    teamA.forEach(pA => {
      teamB.forEach(pB => {
        if (!metMap.get(pA)?.has(pB)) score -= 1000
        else score += 1
      })
    })
    if (partnerMap.get(teamA[0])?.has(teamA[1])) score += 50
    if (partnerMap.get(teamB[0])?.has(teamB[1])) score += 50

    if (score < lowestMatchScore) {
      lowestMatchScore = score
      bestMatch = { teamA, teamB }
    }
  }

  const newPendingIds = new Set([...alreadyPendingIds, ...bestMatch.teamA, ...bestMatch.teamB])
  const sittingOutPlayerIds = activePlayers
    .filter(p => {
      const sid = String(p.id)
      return !busyFromDb.has(sid) && !newPendingIds.has(sid)
    })
    .map(p => String(p.id))

  return { status: 'ok', match: bestMatch, sittingOutPlayerIds }
}
