// Kept for future Round Robin scheduling — intentionally not wired yet.
import type { ArrangementPlayer } from '@/lib/sessionDetail'

export type FixedTeamScoreWeights = {
  invalidTeamPenalty: number
  teamSkillBalance: number
  partnerMatch: number
  partnerMissing: number
  partnerMismatch: number
  opponentFullMatch: number
  opponentPartialMatch: number
  opponentMismatch: number
}

export type FixedTeamOptimizationProfile = 'balanced' | 'preference' | 'skill'

export const DEFAULT_FIXED_TEAM_SCORE_WEIGHTS: FixedTeamScoreWeights = {
  invalidTeamPenalty: 10000,
  teamSkillBalance: 18,
  partnerMatch: 24,
  partnerMissing: 8,
  partnerMismatch: 18,
  opponentFullMatch: 14,
  opponentPartialMatch: 8,
  opponentMismatch: 10,
}

export const FIXED_TEAM_SCORE_PROFILES: Record<FixedTeamOptimizationProfile, FixedTeamScoreWeights> = {
  balanced: DEFAULT_FIXED_TEAM_SCORE_WEIGHTS,
  preference: {
    invalidTeamPenalty: 10000,
    teamSkillBalance: 10,
    partnerMatch: 45,
    partnerMissing: 14,
    partnerMismatch: 34,
    opponentFullMatch: 28,
    opponentPartialMatch: 16,
    opponentMismatch: 20,
  },
  skill: {
    invalidTeamPenalty: 10000,
    teamSkillBalance: 35,
    partnerMatch: 14,
    partnerMissing: 5,
    partnerMismatch: 10,
    opponentFullMatch: 8,
    opponentPartialMatch: 4,
    opponentMismatch: 6,
  },
}

export function getFixedTeamScoreWeights(profile: FixedTeamOptimizationProfile = 'balanced') {
  return FIXED_TEAM_SCORE_PROFILES[profile] || DEFAULT_FIXED_TEAM_SCORE_WEIGHTS
}

export function normalizeGender(value?: string | null) {
  const gender = String(value || '').toLowerCase()
  if (gender === 'female' || gender === 'f' || gender === 'nữ' || gender === 'nu') return 'female'
  if (gender === 'male' || gender === 'm' || gender === 'nam') return 'male'
  return null
}

export function matchesGenderPref(player: ArrangementPlayer, pref?: string | null) {
  if (!pref || pref === 'any') return true
  return normalizeGender(player.gender) === pref
}

export function getPlayerSkill(player: ArrangementPlayer) {
  return Number(player.pvna ?? (player.elo / 100) ?? 0)
}

export function getTeamSkill(teamPlayers: ArrangementPlayer[]) {
  return teamPlayers.reduce((sum, player) => sum + getPlayerSkill(player), 0)
}

export function buildTeamsMap(currentPlayers: ArrangementPlayer[]) {
  const teams = new Map<number, ArrangementPlayer[]>()
  currentPlayers.forEach(player => {
    if (player.team > 0) {
      if (!teams.has(player.team)) teams.set(player.team, [])
      teams.get(player.team)!.push(player)
    }
  })
  return teams
}

export function getOpponentTeamNo(teamNo: number) {
  if (teamNo <= 0) return 0
  return teamNo % 2 === 1 ? teamNo + 1 : teamNo - 1
}

export function hasCompleteFixedPair(players: ArrangementPlayer[]) {
  return Array.from(buildTeamsMap(players).values()).some(teamPlayers => teamPlayers.length === 2)
}

export function scoreFixedTeamAssignments(
  currentPlayers: ArrangementPlayer[],
  targetNumTeams: number,
  weights: FixedTeamScoreWeights = DEFAULT_FIXED_TEAM_SCORE_WEIGHTS
) {
  let score = 0
  const teams = buildTeamsMap(currentPlayers)

  for (let teamNo = 1; teamNo <= targetNumTeams; teamNo++) {
    const teamPlayers = teams.get(teamNo) || []
    if (teamPlayers.length !== 2) score -= weights.invalidTeamPenalty
  }

  for (let teamNo = 1; teamNo <= targetNumTeams; teamNo += 2) {
    const left = teams.get(teamNo) || []
    const right = teams.get(teamNo + 1) || []
    if (left.length === 2 && right.length === 2) {
      score -= Math.abs(getTeamSkill(left) - getTeamSkill(right)) * weights.teamSkillBalance
    }
  }

  currentPlayers.forEach(player => {
    if (player.team <= 0) return
    const partners = (teams.get(player.team) || []).filter(other => other.id !== player.id)
    const opponentTeamNo = getOpponentTeamNo(player.team)
    const opponents = opponentTeamNo > 0 ? (teams.get(opponentTeamNo) || []) : []

    if (player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any') {
      const pref = player.metadata.partner_gender_pref
      const matchedPartners = partners.filter(partner => matchesGenderPref(partner, pref)).length
      if (partners.length === 0) score -= weights.partnerMissing
      else if (matchedPartners > 0) score += weights.partnerMatch
      else score -= weights.partnerMismatch
    }

    if (player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any' && opponents.length > 0) {
      const pref = player.metadata.opponent_gender_pref
      const matchedOpponents = opponents.filter(opponent => matchesGenderPref(opponent, pref)).length
      if (matchedOpponents === opponents.length) score += weights.opponentFullMatch
      else if (matchedOpponents > 0) score += weights.opponentPartialMatch
      else score -= weights.opponentMismatch
    }
  })

  return score
}
