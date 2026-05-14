import { type ArrangementPlayer } from '@/lib/sessionDetail'
import { getPlayerSkill, matchesGenderPref } from './scoring'

export interface RotationScheduledMatch {
  id: string
  rotation: number
  court: number
  teamA: string[]
  teamB: string[]
}

export interface RotationOptimizationResult {
  players: ArrangementPlayer[]
  matches: RotationScheduledMatch[]
  quality: {
    runtimeMs: number
    score: number
    overallScore: number
  }
}

type PlayerState = {
  id: string
  quota: number
  games: number
  lastRotation: number | null
}

type TeamSplit = {
  teamA: string[]
  teamB: string[]
  score: number
  skillGap: number
}

const pairKey = (a: string, b: string) => a < b ? `${a}_${b}` : `${b}_${a}`

const ROTATION_SCORE_WEIGHTS = {
  quotaRemaining: 80,
  gamesPlayed: 6,
  firstGameBonus: 16,
  consecutiveRestPenalty: 38,
  idealRestBonus: 18,
  okRestBonus: 10,
  longRestUrgencyBonus: 36,
  severeLongRestUrgencyBonus: 90,
  skillGapSquared: 200,
  largeSkillGapSquared: 2000,
  partnerRepeat: 110,
  opponentRepeat: 30,
  partnerPreference: 28,
  opponentPreference: 12,
  planQuotaMiss: 400,
  planOverQuota: 2000,
  planPartnerRepeat: 110,
  planOpponentRepeat: 30,
  planConsecutiveRest: 30,
  planLongRest: 70,
  planOverMaxRest: 200000,
  planSkillGapSquared: 200,
  planLargeSkillGapSquared: 2000,
  planSkillGapOverLimit: 1200,
  planPlayerPreferenceUnderTarget: 25000,
}

const MIN_PLAYER_PREFERENCE_RATIO = 0.75
const MAX_ROTATION_SKILL_GAP = 0.5
const ACCEPTABLE_ROTATION_SKILL_GAP = 0.8

type RandomSource = () => number

function createSeededRandom(seed: number): RandomSource {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleCopy<T>(items: T[], random: RandomSource) {
  return [...items].sort(() => random() - 0.5)
}

function incrementPair(map: Map<string, number>, a: string, b: string) {
  const key = pairKey(a, b)
  map.set(key, (map.get(key) || 0) + 1)
}

function getPairCount(map: Map<string, number>, a: string, b: string) {
  return map.get(pairKey(a, b)) || 0
}

function buildQuotas(playerIds: string[], targetGamesPerPlayer: number, random: RandomSource) {
  const safeTarget = Math.max(0, Math.floor(targetGamesPerPlayer || 0))
  const totalDesiredSlots = playerIds.length * safeTarget
  const feasibleSlots = Math.floor(totalDesiredSlots / 4) * 4
  const quotas = new Map<string, number>(playerIds.map(id => [id, safeTarget]))
  let reductionsNeeded = totalDesiredSlots - feasibleSlots

  // If exact equality is mathematically impossible, keep everyone at target or target - 1.
  for (const id of shuffleCopy(playerIds, random)) {
    if (reductionsNeeded <= 0) break
    quotas.set(id, Math.max(0, (quotas.get(id) || 0) - 1))
    reductionsNeeded--
  }

  return quotas
}

function getMatchPlayers(match: RotationScheduledMatch) {
  return [...match.teamA, ...match.teamB]
}

function scorePlayerPreferenceAttempt(
  id: string,
  partnerId: string,
  opponentIds: string[],
  playerById: Map<string, ArrangementPlayer>,
  playerPreferenceStats: Map<string, { hits: number; total: number }>
) {
  const player = playerById.get(id)
  if (!player) return

  const stats = playerPreferenceStats.get(id) || { hits: 0, total: 0 }
  const partner = playerById.get(partnerId)
  const opponents = opponentIds.map(oppId => playerById.get(oppId)).filter(Boolean) as ArrangementPlayer[]

  if (player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any') {
    stats.total++
    if (partner && matchesGenderPref(partner, player.metadata.partner_gender_pref)) stats.hits++
  }

  if (player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any') {
    stats.total++
    if (opponents.some(opponent => matchesGenderPref(opponent, player.metadata.opponent_gender_pref))) stats.hits++
  }

  playerPreferenceStats.set(id, stats)
}

function hasDuplicateInRotation(matches: RotationScheduledMatch[]) {
  const seenByRotation = new Map<number, Set<string>>()
  for (const match of matches) {
    const seen = seenByRotation.get(match.rotation) || new Set<string>()
    for (const id of getMatchPlayers(match)) {
      if (seen.has(id)) return true
      seen.add(id)
    }
    seenByRotation.set(match.rotation, seen)
  }
  return false
}

function chooseBestTeamSplit(
  group: string[],
  playerById: Map<string, ArrangementPlayer>,
  partnerPairs: Map<string, number>,
  opponentPairs: Map<string, number>,
  random: RandomSource
): TeamSplit {
  const splits = [
    [[group[0], group[1]], [group[2], group[3]]],
    [[group[0], group[2]], [group[1], group[3]]],
    [[group[0], group[3]], [group[1], group[2]]],
  ]

  let best: TeamSplit | null = null
  for (const [teamA, teamB] of splits) {
    const teamASkill = teamA.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    const teamBSkill = teamB.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    const skillGap = Math.abs(teamASkill - teamBSkill)

    let score = 100
    if (skillGap > MAX_ROTATION_SKILL_GAP) score -= ROTATION_SCORE_WEIGHTS.planSkillGapOverLimit
    score -= Math.pow(skillGap, 2) * (skillGap > MAX_ROTATION_SKILL_GAP
      ? ROTATION_SCORE_WEIGHTS.largeSkillGapSquared
      : ROTATION_SCORE_WEIGHTS.skillGapSquared)
    score -= getPairCount(partnerPairs, teamA[0], teamA[1]) * ROTATION_SCORE_WEIGHTS.partnerRepeat
    score -= getPairCount(partnerPairs, teamB[0], teamB[1]) * ROTATION_SCORE_WEIGHTS.partnerRepeat

    teamA.forEach(a => teamB.forEach(b => {
      score -= getPairCount(opponentPairs, a, b) * ROTATION_SCORE_WEIGHTS.opponentRepeat
    }))

    const scorePreference = (id: string, partnerId: string, opponentIds: string[]) => {
      const player = playerById.get(id)!
      const partner = playerById.get(partnerId)!
      const opponents = opponentIds.map(oppId => playerById.get(oppId)!)
      let prefScore = 0
      if (matchesGenderPref(partner, player.metadata?.partner_gender_pref)) prefScore += ROTATION_SCORE_WEIGHTS.partnerPreference
      if (opponents.some(opponent => matchesGenderPref(opponent, player.metadata?.opponent_gender_pref))) prefScore += ROTATION_SCORE_WEIGHTS.opponentPreference
      return prefScore
    }

    score += scorePreference(teamA[0], teamA[1], teamB)
    score += scorePreference(teamA[1], teamA[0], teamB)
    score += scorePreference(teamB[0], teamB[1], teamA)
    score += scorePreference(teamB[1], teamB[0], teamA)
    score += random() * 0.001

    if (!best || score > best.score) {
      best = { teamA: [...teamA], teamB: [...teamB], score, skillGap }
    }
  }

  return best || { teamA: [group[0], group[1]], teamB: [group[2], group[3]], score: 0, skillGap: 0 }
}

function getTeamSplitVariants(group: string[]) {
  return [
    { teamA: [group[0], group[1]], teamB: [group[2], group[3]] },
    { teamA: [group[0], group[2]], teamB: [group[1], group[3]] },
    { teamA: [group[0], group[3]], teamB: [group[1], group[2]] },
  ]
}

function scoreCandidateGroup(
  group: string[],
  rotation: number,
  states: Map<string, PlayerState>,
  playerById: Map<string, ArrangementPlayer>,
  partnerPairs: Map<string, number>,
  opponentPairs: Map<string, number>,
  random: RandomSource
) {
  const split = chooseBestTeamSplit(group, playerById, partnerPairs, opponentPairs, random)
  let score = split.score

  for (const id of group) {
    const state = states.get(id)!
    const remaining = state.quota - state.games
    score += remaining * ROTATION_SCORE_WEIGHTS.quotaRemaining
    score -= state.games * ROTATION_SCORE_WEIGHTS.gamesPlayed

    if (state.lastRotation == null) {
      score += ROTATION_SCORE_WEIGHTS.firstGameBonus
    } else {
      const gap = rotation - state.lastRotation
      if (gap === 1) score -= ROTATION_SCORE_WEIGHTS.consecutiveRestPenalty
      else if (gap === 2) score += ROTATION_SCORE_WEIGHTS.idealRestBonus
      else if (gap === 3) score += ROTATION_SCORE_WEIGHTS.okRestBonus
      else if (gap === 4) score += ROTATION_SCORE_WEIGHTS.longRestUrgencyBonus
      else if (gap >= 5) score += ROTATION_SCORE_WEIGHTS.severeLongRestUrgencyBonus + (gap - 5) * 30
    }
  }

  return { group, split, score: score + random() * 0.001 }
}

function getCombinationsOfFour(items: string[]) {
  const combos: string[][] = []
  for (let a = 0; a < items.length - 3; a++) {
    for (let b = a + 1; b < items.length - 2; b++) {
      for (let c = b + 1; c < items.length - 1; c++) {
        for (let d = c + 1; d < items.length; d++) {
          combos.push([items[a], items[b], items[c], items[d]])
        }
      }
    }
  }
  return combos
}

function getRestUrgencyScore(restGap: number) {
  if (restGap >= 999) return 80
  if (restGap <= 3) return restGap * 18
  return 54 + (restGap - 3) * 70
}

function getRestGap(id: string, rotation: number, states: Map<string, PlayerState>) {
  const state = states.get(id)!
  return state.lastRotation == null ? 999 : rotation - state.lastRotation
}

function getForcedRestPlayers(
  eligible: string[],
  rotation: number,
  states: Map<string, PlayerState>,
  limit: number
) {
  return [...eligible]
    .filter(id => {
      const gap = getRestGap(id, rotation, states)
      return gap >= 3 && gap < 999
    })
    .sort((a, b) => {
      const gapDiff = getRestGap(b, rotation, states) - getRestGap(a, rotation, states)
      if (gapDiff !== 0) return gapDiff
      const stateA = states.get(a)!
      const stateB = states.get(b)!
      const remainingA = stateA.quota - stateA.games
      const remainingB = stateB.quota - stateB.games
      if (remainingA !== remainingB) return remainingB - remainingA
      return stateA.games - stateB.games
    })
    .slice(0, limit)
}

function getCandidatePool(
  eligible: string[],
  rotation: number,
  states: Map<string, PlayerState>,
  playerById: Map<string, ArrangementPlayer>
) {
  const priorityPool = [...eligible]
    .sort((a, b) => {
      const stateA = states.get(a)!
      const stateB = states.get(b)!
      const remainingA = stateA.quota - stateA.games
      const remainingB = stateB.quota - stateB.games

      const restA = stateA.lastRotation == null ? 999 : rotation - stateA.lastRotation
      const restB = stateB.lastRotation == null ? 999 : rotation - stateB.lastRotation
      const priorityA = remainingA * 100 + getRestUrgencyScore(restA) - stateA.games * 3
      const priorityB = remainingB * 100 + getRestUrgencyScore(restB) - stateB.games * 3
      if (priorityA !== priorityB) return priorityB - priorityA

      if (stateA.games !== stateB.games) return stateA.games - stateB.games
      return a.localeCompare(b)
    })
    .slice(0, Math.min(eligible.length, 10))

  const bySkill = [...eligible].sort((a, b) => getPlayerSkill(playerById.get(a)!) - getPlayerSkill(playerById.get(b)!))
  const skillPool = [
    ...bySkill.slice(0, 3),
    ...bySkill.slice(Math.max(0, bySkill.length - 3)),
  ]

  return [...new Set([...priorityPool, ...skillPool])]
    .slice(0, Math.min(eligible.length, 16))
}

function calculatePlanScore(
  matches: RotationScheduledMatch[],
  playerIds: string[],
  playerById: Map<string, ArrangementPlayer>,
  quotas: Map<string, number>,
  courtCount: number
) {
  const games = new Map<string, number>(playerIds.map(id => [id, 0]))
  const playerRotations = new Map<string, number[]>(playerIds.map(id => [id, []]))
  const partnerPairs = new Map<string, number>()
  const opponentPairs = new Map<string, number>()
  const playerPreferenceStats = new Map<string, { hits: number; total: number }>()
  const rotationCourtCount = new Map<number, number>()
  let hardPenalty = 0
  let skillPenalty = 0

  matches.forEach(match => {
    const all = getMatchPlayers(match)
    if (all.length !== 4 || new Set(all).size !== 4) hardPenalty += 10000
    rotationCourtCount.set(match.rotation, (rotationCourtCount.get(match.rotation) || 0) + 1)

    all.forEach(id => {
      games.set(id, (games.get(id) || 0) + 1)
      playerRotations.get(id)?.push(match.rotation)
    })

    incrementPair(partnerPairs, match.teamA[0], match.teamA[1])
    incrementPair(partnerPairs, match.teamB[0], match.teamB[1])
    match.teamA.forEach(a => match.teamB.forEach(b => incrementPair(opponentPairs, a, b)))
    scorePlayerPreferenceAttempt(match.teamA[0], match.teamA[1], match.teamB, playerById, playerPreferenceStats)
    scorePlayerPreferenceAttempt(match.teamA[1], match.teamA[0], match.teamB, playerById, playerPreferenceStats)
    scorePlayerPreferenceAttempt(match.teamB[0], match.teamB[1], match.teamA, playerById, playerPreferenceStats)
    scorePlayerPreferenceAttempt(match.teamB[1], match.teamB[0], match.teamA, playerById, playerPreferenceStats)

    const teamASkill = match.teamA.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    const teamBSkill = match.teamB.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    const skillGap = Math.abs(teamASkill - teamBSkill)
    if (skillGap > MAX_ROTATION_SKILL_GAP) {
      skillPenalty += (skillGap - MAX_ROTATION_SKILL_GAP) * ROTATION_SCORE_WEIGHTS.planSkillGapOverLimit
    }
    skillPenalty += Math.pow(skillGap, 2) * (skillGap > MAX_ROTATION_SKILL_GAP
      ? ROTATION_SCORE_WEIGHTS.planLargeSkillGapSquared
      : ROTATION_SCORE_WEIGHTS.planSkillGapSquared)
  })

  if (hasDuplicateInRotation(matches)) hardPenalty += 10000
  rotationCourtCount.forEach(count => {
    if (count > courtCount) hardPenalty += (count - courtCount) * 10000
  })

  let gamePenalty = 0
  games.forEach((count, id) => {
    const quota = quotas.get(id) || 0
    gamePenalty += Math.abs(quota - count) * ROTATION_SCORE_WEIGHTS.planQuotaMiss
    if (count > quota) gamePenalty += (count - quota) * ROTATION_SCORE_WEIGHTS.planOverQuota
  })

  let partnerPenalty = 0
  partnerPairs.forEach(count => {
    if (count > 1) partnerPenalty += (count - 1) * ROTATION_SCORE_WEIGHTS.planPartnerRepeat
  })

  let opponentPenalty = 0
  opponentPairs.forEach(count => {
    if (count > 1) opponentPenalty += (count - 1) * ROTATION_SCORE_WEIGHTS.planOpponentRepeat
  })

  let restPenalty = 0
  playerRotations.forEach(rotations => {
    const sorted = [...rotations].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i]
      if (gap === 1) hardPenalty += 1_000_000
      if (gap >= 3) hardPenalty += (gap - 2) * ROTATION_SCORE_WEIGHTS.planOverMaxRest
      if (gap === 4) restPenalty += 45
      if (gap >= 5) restPenalty += Math.min(900, 180 + (gap - 5) * ROTATION_SCORE_WEIGHTS.planLongRest)
    }
  })

  let playerPreferencePenalty = 0
  playerPreferenceStats.forEach(stats => {
    if (stats.total === 0) return
    const ratio = stats.hits / stats.total
    if (ratio < MIN_PLAYER_PREFERENCE_RATIO) {
      playerPreferencePenalty += Math.ceil((MIN_PLAYER_PREFERENCE_RATIO - ratio) * 100) * ROTATION_SCORE_WEIGHTS.planPlayerPreferenceUnderTarget
    }
  })

  return 1000 - hardPenalty - gamePenalty - partnerPenalty - opponentPenalty - restPenalty - skillPenalty - playerPreferencePenalty
}

function calculateOverallScore(
  matches: RotationScheduledMatch[],
  playerIds: string[],
  playerById: Map<string, ArrangementPlayer>,
  quotas: Map<string, number>
) {
  if (matches.length === 0) return 0

  const games = new Map<string, number>(playerIds.map(id => [id, 0]))
  const playerRotations = new Map<string, number[]>(playerIds.map(id => [id, []]))
  const partnerPairs = new Map<string, number>()
  const opponentPairs = new Map<string, number>()
  let totalSkillGap = 0
  let preferenceHits = 0
  let preferenceTotal = 0

  matches.forEach(match => {
    getMatchPlayers(match).forEach(id => {
      games.set(id, (games.get(id) || 0) + 1)
      playerRotations.get(id)?.push(match.rotation)
    })
    incrementPair(partnerPairs, match.teamA[0], match.teamA[1])
    incrementPair(partnerPairs, match.teamB[0], match.teamB[1])
    match.teamA.forEach(a => match.teamB.forEach(b => incrementPair(opponentPairs, a, b)))

    const teamASkill = match.teamA.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    const teamBSkill = match.teamB.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)!), 0)
    totalSkillGap += Math.abs(teamASkill - teamBSkill)

    const scorePreference = (id: string, partnerId: string, opponentIds: string[]) => {
      const player = playerById.get(id)
      const partner = playerById.get(partnerId)
      const opponents = opponentIds.map(oppId => playerById.get(oppId)).filter(Boolean) as ArrangementPlayer[]

      if (player?.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any') {
        preferenceTotal++
        if (partner && matchesGenderPref(partner, player.metadata.partner_gender_pref)) preferenceHits++
      }

      if (player?.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any') {
        preferenceTotal++
        if (opponents.some(opponent => matchesGenderPref(opponent, player.metadata.opponent_gender_pref))) preferenceHits++
      }
    }

    scorePreference(match.teamA[0], match.teamA[1], match.teamB)
    scorePreference(match.teamA[1], match.teamA[0], match.teamB)
    scorePreference(match.teamB[0], match.teamB[1], match.teamA)
    scorePreference(match.teamB[1], match.teamB[0], match.teamA)
  })

  let consecutiveCount = 0
  let longRestCount = 0
  playerRotations.forEach(rotations => {
    const sorted = [...rotations].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i]
      if (gap === 1) consecutiveCount++
      if (gap >= 5) longRestCount++
    }
  })
  const restScore = Math.max(0, 100 - consecutiveCount * 8 - longRestCount * 12)

  let partnerRepeats = 0
  partnerPairs.forEach(count => {
    if (count > 1) partnerRepeats += count - 1
  })
  const partnerDiversityScore = Math.max(0, 100 - partnerRepeats * 18)

  let opponentRepeats = 0
  opponentPairs.forEach(count => {
    if (count > 1) opponentRepeats += count - 1
  })
  const opponentDiversityScore = Math.max(0, 100 - opponentRepeats * 5)

  const avgSkillGap = totalSkillGap / matches.length
  const skillBalanceScore = Math.max(0, 100 - avgSkillGap * 80)
  const preferenceScore = preferenceTotal > 0 ? (preferenceHits / preferenceTotal) * 100 : 100

  return Math.round(
    skillBalanceScore * 0.30 +
    partnerDiversityScore * 0.25 +
    opponentDiversityScore * 0.10 +
    restScore * 0.15 +
    preferenceScore * 0.20
  )
}

/**
 * Individual rotation optimizer.
 *
 * Builds a valid schedule from per-player quotas first, then improves soft
 * quality signals. If exact target games are impossible because total slots
 * are not divisible by 4, some players receive target - 1 games.
 */
export function optimizeRotationPlan(
  players: ArrangementPlayer[],
  options: {
    targetGamesPerPlayer: number
    courtCount: number
    iterations?: number
    seed?: number
  }
): RotationOptimizationResult {
  const { targetGamesPerPlayer, courtCount, iterations = 20000, seed = 1 } = options
  const random = createSeededRandom(seed)
  const startedAt = Date.now()

  const effectiveCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const playerIds = players.map(p => String(p.id))
  const playerById = new Map<string, ArrangementPlayer>()
  players.forEach(p => playerById.set(String(p.id), p))

  if (playerIds.length < 4 || targetGamesPerPlayer <= 0) {
    return {
      players,
      matches: [],
      quality: {
        runtimeMs: Date.now() - startedAt,
        score: 0,
        overallScore: 0,
      },
    }
  }

  const quotas = buildQuotas(playerIds, targetGamesPerPlayer, random)
  const states = new Map<string, PlayerState>()
  playerIds.forEach(id => {
    states.set(id, {
      id,
      quota: quotas.get(id) || 0,
      games: 0,
      lastRotation: null,
    })
  })

  const partnerPairs = new Map<string, number>()
  const opponentPairs = new Map<string, number>()
  const matches: RotationScheduledMatch[] = []
  let rotation = 1
  let matchIdCounter = 0

  const remainingSlots = () => {
    let total = 0
    states.forEach(state => {
      total += Math.max(0, state.quota - state.games)
    })
    return total
  }

  scheduleLoop:
  while (remainingSlots() >= 4) {
    const usedThisRotation = new Set<string>()
    let matchesInRotation = 0

    while (matchesInRotation < effectiveCourtCount) {
      const eligible = playerIds.filter(id => {
        const state = states.get(id)!
        return state.games < state.quota && !usedThisRotation.has(id) && state.lastRotation !== rotation - 1
      })

      if (eligible.length < 4) break

      const forcedPlayers = getForcedRestPlayers(eligible, rotation, states, 4)
      const candidatePool = [...new Set([
        ...forcedPlayers,
        ...getCandidatePool(eligible, rotation, states, playerById),
      ])]
      const allCandidates = getCombinationsOfFour(candidatePool)
      const forcedCandidates = forcedPlayers.length > 0
        ? allCandidates.filter(group => forcedPlayers.every(id => group.includes(id)))
        : allCandidates
      const candidateGroups = forcedCandidates.length > 0 ? forcedCandidates : allCandidates
      let scoredCandidates = candidateGroups
        .map(group => scoreCandidateGroup(group, rotation, states, playerById, partnerPairs, opponentPairs, random))
        .sort((a, b) => b.score - a.score)
      let skillSafeCandidates = scoredCandidates.filter(candidate => candidate.split.skillGap <= MAX_ROTATION_SKILL_GAP)
      let skillAcceptableCandidates = scoredCandidates.filter(candidate => candidate.split.skillGap <= ACCEPTABLE_ROTATION_SKILL_GAP)

      if (skillSafeCandidates.length === 0 && candidatePool.length < eligible.length) {
        const broadCandidates = getCombinationsOfFour(eligible)
        const broadForcedCandidates = forcedPlayers.length > 0
          ? broadCandidates.filter(group => forcedPlayers.every(id => group.includes(id)))
          : broadCandidates
        const broadCandidateGroups = broadForcedCandidates.length > 0 ? broadForcedCandidates : broadCandidates
        scoredCandidates = broadCandidateGroups
          .map(group => scoreCandidateGroup(group, rotation, states, playerById, partnerPairs, opponentPairs, random))
          .sort((a, b) => b.score - a.score)
        skillSafeCandidates = scoredCandidates.filter(candidate => candidate.split.skillGap <= MAX_ROTATION_SKILL_GAP)
        skillAcceptableCandidates = scoredCandidates.filter(candidate => candidate.split.skillGap <= ACCEPTABLE_ROTATION_SKILL_GAP)
      }

      const best = skillSafeCandidates[0] || skillAcceptableCandidates[0] || scoredCandidates[0]
      if (!best) break

      matches.push({
        id: `m-${matchIdCounter++}`,
        rotation,
        court: matchesInRotation + 1,
        teamA: best.split.teamA,
        teamB: best.split.teamB,
      })

      best.group.forEach(id => {
        const state = states.get(id)!
        state.games += 1
        state.lastRotation = rotation
        usedThisRotation.add(id)
      })
      incrementPair(partnerPairs, best.split.teamA[0], best.split.teamA[1])
      incrementPair(partnerPairs, best.split.teamB[0], best.split.teamB[1])
      best.split.teamA.forEach(a => best.split.teamB.forEach(b => incrementPair(opponentPairs, a, b)))
      matchesInRotation++
    }

    if (matchesInRotation === 0) break scheduleLoop
    rotation++
  }

  let bestMatches = matches.map(match => ({ ...match, teamA: [...match.teamA], teamB: [...match.teamB] }))
  let bestScore = calculatePlanScore(bestMatches, playerIds, playerById, quotas, effectiveCourtCount)
  const localSearchIterations = Math.min(
    Math.max(0, iterations),
    Math.max(200, Math.min(1800, bestMatches.length * 60))
  )

  const optimizeMatchSplit = (schedule: RotationScheduledMatch[], matchIndex: number) => {
    const match = schedule[matchIndex]
    const group = getMatchPlayers(match)
    let bestLocalMatch = match
    let bestLocalScore = calculatePlanScore(schedule, playerIds, playerById, quotas, effectiveCourtCount)

    for (const split of getTeamSplitVariants(group)) {
      const nextSchedule = schedule.map((candidate, index) => index === matchIndex
        ? { ...candidate, teamA: split.teamA, teamB: split.teamB }
        : candidate)
      const score = calculatePlanScore(nextSchedule, playerIds, playerById, quotas, effectiveCourtCount)
      if (score > bestLocalScore) {
        bestLocalScore = score
        bestLocalMatch = nextSchedule[matchIndex]
      }
    }

    schedule[matchIndex] = bestLocalMatch
    return bestLocalScore
  }

  for (let i = 0; i < localSearchIterations; i++) {
    if (bestMatches.length === 0) break

    const nextMatches = bestMatches.map(match => ({ ...match, teamA: [...match.teamA], teamB: [...match.teamB] }))
    const changeType = random()

    if (changeType < 0.25) {
      const matchIndex = Math.floor(random() * nextMatches.length)
      optimizeMatchSplit(nextMatches, matchIndex)
    } else {
      if (nextMatches.length < 2) continue

      const m1Idx = Math.floor(random() * nextMatches.length)
      const m2Idx = Math.floor(random() * nextMatches.length)
      if (m1Idx === m2Idx) continue

      const m1 = nextMatches[m1Idx]
      const m2 = nextMatches[m2Idx]
      const m1Players = getMatchPlayers(m1)
      const m2Players = getMatchPlayers(m2)
      const p1Idx = Math.floor(random() * 4)
      const p2Idx = Math.floor(random() * 4)
      const p1 = m1Players[p1Idx]
      const p2 = m2Players[p2Idx]

      m1Players[p1Idx] = p2
      m2Players[p2Idx] = p1
      if (new Set(m1Players).size !== 4 || new Set(m2Players).size !== 4) continue

      nextMatches[m1Idx] = { ...m1, teamA: [m1Players[0], m1Players[1]], teamB: [m1Players[2], m1Players[3]] }
      nextMatches[m2Idx] = { ...m2, teamA: [m2Players[0], m2Players[1]], teamB: [m2Players[2], m2Players[3]] }

      if (hasDuplicateInRotation(nextMatches)) continue

      optimizeMatchSplit(nextMatches, m1Idx)
      optimizeMatchSplit(nextMatches, m2Idx)
    }

    const hasBackToBack = (schedule: RotationScheduledMatch[]) => {
      const pRots = new Map<string, number[]>()
      schedule.forEach(m => {
        getMatchPlayers(m).forEach(p => {
          if (!pRots.has(p)) pRots.set(p, [])
          pRots.get(p)!.push(m.rotation || 0)
        })
      })
      for (const rots of pRots.values()) {
        const sorted = [...rots].sort((a, b) => a - b)
        for (let j = 0; j < sorted.length - 1; j++) {
          if (sorted[j + 1] - sorted[j] === 1) return true
        }
      }
      return false
    }

    if (hasBackToBack(nextMatches)) continue

    const nextScore = calculatePlanScore(nextMatches, playerIds, playerById, quotas, effectiveCourtCount)
    if (nextScore > bestScore) {
      bestScore = nextScore
      bestMatches = nextMatches
    }
  }

  return {
    players,
    matches: bestMatches,
    quality: {
      runtimeMs: Date.now() - startedAt,
      score: bestScore,
      overallScore: calculateOverallScore(bestMatches, playerIds, playerById, quotas),
    },
  }
}
