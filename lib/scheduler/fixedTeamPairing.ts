import type { ArrangementPlayer } from '@/lib/sessionDetail'
import {
  buildTeamsMap,
  getPlayerSkill,
  getTeamSkill,
  getFixedTeamScoreWeights,
  hasCompleteFixedPair,
  scoreFixedTeamAssignments,
  type FixedTeamOptimizationProfile,
} from './scoring'

type FixedTeamGroup = {
  players: ArrangementPlayer[]
  skill: number
}

type ArrangeFixedTeamsOptions = {
  attempts?: number
  preserveExistingPairs?: boolean
  profile?: FixedTeamOptimizationProfile
}

function assignGroupsToTeamNumbers(groups: FixedTeamGroup[], waitingPlayers: ArrangementPlayer[], targetNumTeams: number) {
  const assigned: ArrangementPlayer[] = []
  groups.forEach((group, idx) => {
    const teamNo = idx + 1
    group.players.forEach(player => {
      assigned.push({ ...player, team: teamNo <= targetNumTeams ? teamNo : 0 })
    })
  })
  waitingPlayers.forEach(player => assigned.push({ ...player, team: 0 }))
  return assigned
}

function shuffleCopy<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5)
}

function buildHighLowPairs(players: ArrangementPlayer[], targetNumTeams: number) {
  const sorted = [...players].sort((a, b) => getPlayerSkill(b) - getPlayerSkill(a))
  const pairs: FixedTeamGroup[] = []
  const pairedIds = new Set<string>()
  let left = 0
  let right = sorted.length - 1

  while (pairs.length < targetNumTeams && right > left) {
    const pairPlayers = [sorted[left], sorted[right]]
    pairs.push({ players: pairPlayers, skill: getTeamSkill(pairPlayers) })
    pairedIds.add(pairPlayers[0].id)
    pairedIds.add(pairPlayers[1].id)
    left++
    right--
  }

  const waitingPlayers = players.filter(player => !pairedIds.has(player.id))
  return { pairs, waitingPlayers }
}

function buildRandomPairs(players: ArrangementPlayer[], targetNumTeams: number) {
  const shuffled = shuffleCopy(players)
  const pairs: FixedTeamGroup[] = []
  const pairedIds = new Set<string>()

  for (let idx = 0; idx + 1 < shuffled.length && pairs.length < targetNumTeams; idx += 2) {
    const pairPlayers = [shuffled[idx], shuffled[idx + 1]]
    pairs.push({ players: pairPlayers, skill: getTeamSkill(pairPlayers) })
    pairedIds.add(pairPlayers[0].id)
    pairedIds.add(pairPlayers[1].id)
  }

  const waitingPlayers = players.filter(player => !pairedIds.has(player.id))
  return { pairs, waitingPlayers }
}

function collectExistingCompletePairs(players: ArrangementPlayer[]) {
  const existingTeams = Array.from(buildTeamsMap(players).values())
    .filter(teamPlayers => teamPlayers.length === 2)
    .map(teamPlayers => ({ players: teamPlayers, skill: getTeamSkill(teamPlayers) }))
  const pairedIds = new Set(existingTeams.flatMap(team => team.players.map(player => player.id)))
  return {
    pairs: existingTeams,
    waitingPlayers: players.filter(player => !pairedIds.has(player.id)),
    pairedIds,
  }
}

function fillMissingPairs(existingPairs: FixedTeamGroup[], waitingPlayers: ArrangementPlayer[], targetNumTeams: number) {
  const pairs = [...existingPairs]
  const sortedWaitingPlayers = [...waitingPlayers].sort((a, b) => getPlayerSkill(b) - getPlayerSkill(a))
  const newlyPairedIds = new Set<string>()
  let left = 0
  let right = sortedWaitingPlayers.length - 1

  while (pairs.length < targetNumTeams && right > left) {
    const pairPlayers = [sortedWaitingPlayers[left], sortedWaitingPlayers[right]]
    pairs.push({ players: pairPlayers, skill: getTeamSkill(pairPlayers) })
    newlyPairedIds.add(pairPlayers[0].id)
    newlyPairedIds.add(pairPlayers[1].id)
    left++
    right--
  }

  return {
    pairs,
    waitingPlayers: waitingPlayers.filter(player => !newlyPairedIds.has(player.id)),
  }
}

export function arrangeFixedTeams(
  players: ArrangementPlayer[],
  targetNumTeams: number,
  options: ArrangeFixedTeamsOptions = {}
) {
  const attempts = options.attempts ?? 80
  const weights = getFixedTeamScoreWeights(options.profile || 'balanced')
  const preserveExistingPairs = options.preserveExistingPairs ?? hasCompleteFixedPair(players)
  const existingPairs = collectExistingCompletePairs(players)
  const base = preserveExistingPairs
    ? fillMissingPairs(
        existingPairs.pairs,
        existingPairs.waitingPlayers,
        targetNumTeams
      )
    : buildHighLowPairs(players, targetNumTeams)

  let bestResult = assignGroupsToTeamNumbers(base.pairs, base.waitingPlayers, targetNumTeams)
  let bestScore = scoreFixedTeamAssignments(bestResult, targetNumTeams, weights)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const source = preserveExistingPairs ? base : (attempt % 3 === 0 ? buildHighLowPairs(players, targetNumTeams) : buildRandomPairs(players, targetNumTeams))
    const groups = shuffleCopy(source.pairs)
    const candidate = assignGroupsToTeamNumbers(groups, source.waitingPlayers, targetNumTeams)
    const score = scoreFixedTeamAssignments(candidate, targetNumTeams, weights)

    if (score > bestScore) {
      bestScore = score
      bestResult = candidate
    }
  }

  return bestResult
}

export function shuffleFixedTeamOrder(players: ArrangementPlayer[], targetNumTeams: number) {
  const { pairs, waitingPlayers } = collectExistingCompletePairs(players)
  if (pairs.length === 0) {
    return arrangeFixedTeams(players, targetNumTeams, { preserveExistingPairs: false })
  }
  const filled = fillMissingPairs(pairs, waitingPlayers, targetNumTeams)
  return assignGroupsToTeamNumbers(shuffleCopy(filled.pairs), filled.waitingPlayers, targetNumTeams)
}
