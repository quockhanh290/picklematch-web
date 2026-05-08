import { 
  ELO_BANDS, 
  type EloLevelId, 
  type EloTier, 
  type LegacySkillLabel,
  type EloBand
} from '@/constants/systemData'

export { 
  ELO_BANDS, 
  type EloLevelId, 
  type EloTier, 
  type LegacySkillLabel,
  type EloBand
}

export const CREATE_SESSION_ELO_LEVELS = ELO_BANDS.map((band) => ({ elo: band.seedElo }))

export function getEloBandByLevelId(levelId?: string | null) {
  if (!levelId) return null
  return ELO_BANDS.find((band) => band.levelId === levelId) ?? null
}

export function getEloBandByTier(tier?: string | null) {
  if (!tier) return null
  return ELO_BANDS.find((band) => band.tier === tier) ?? ELO_BANDS[0]
}

export function getEloBandByLegacySkillLabel(skillLabel?: string | null) {
  switch (skillLabel) {
    case 'beginner':
      return ELO_BANDS[0]
    case 'basic':
      return ELO_BANDS[1]
    case 'intermediate':
      return ELO_BANDS[2]
    case 'advanced':
      return ELO_BANDS[5]
    default:
      return ELO_BANDS[0]
  }
}

export function getEloBandForElo(elo?: number | null) {
  if (elo == null) return null
  if (elo <= ELO_BANDS[0].eloMin) return ELO_BANDS[0]
  if (elo >= ELO_BANDS[ELO_BANDS.length - 1].eloMax) return ELO_BANDS[ELO_BANDS.length - 1]
  return ELO_BANDS.find((band) => elo >= band.eloMin && elo <= band.eloMax) ?? ELO_BANDS[0]
}

export function getEloBandForSessionRange(eloMin: number, eloMax: number) {
  const midpoint = Math.round((eloMin + eloMax) / 2)
  return getEloBandForElo(midpoint) ?? ELO_BANDS[0]
}

export function getLevelIdForElo(elo: number): EloLevelId {
  return (getEloBandForElo(elo) ?? ELO_BANDS[0]).levelId
}

export function getTierForElo(elo: number): EloTier {
  return (getEloBandForElo(elo) ?? ELO_BANDS[0]).tier
}

export function getLegacySkillLabelForTier(tier: string): LegacySkillLabel {
  return (getEloBandByTier(tier) ?? ELO_BANDS[0]).legacySkillLabel
}

export function getSimpleTierLabel(tier: string) {
  return (getEloBandByTier(tier) ?? ELO_BANDS[0]).simpleLabel
}

export function getShortLabelForLevelId(levelId?: string | null) {
  return (getEloBandByLevelId(levelId) ?? ELO_BANDS[0]).shortLabel
}

export function getUserDescriptionForLevelId(levelId?: string | null) {
  return (getEloBandByLevelId(levelId) ?? ELO_BANDS[0]).userDescription
}

export function getUserDescriptionForTier(tier?: string | null) {
  return (getEloBandByTier(tier) ?? ELO_BANDS[0]).userDescription
}

export function getEloRangeForLevel(levelId: EloLevelId) {
  const band = getEloBandByLevelId(levelId) ?? ELO_BANDS[2]
  return { elo_min: band.eloMin, elo_max: band.eloMax }
}
