import {
  ELO_BANDS,
  getEloBandByLegacySkillLabel,
  getEloBandByTier,
  getEloBandForElo,
  getEloBandForSessionRange,
  getShortLabelForLevelId,
} from './eloSystem'
import { supabase } from './supabase'

export type SkillAssessmentLevel = {
  id: EloLevelId
  title: string
  subtitle: string
  pvna: string
  description: string
  starting_elo: number
  legacy_skill_label: LegacySkillLabel
}

export const SKILL_ASSESSMENT_LEVELS: SkillAssessmentLevel[] = [
  {
    id: 'pvna_1',
    title: '2.1',
    subtitle: 'Bắt đầu làm quen',
    pvna: '2.1 - 2.5',
    description: 'Mới làm quen, đang học luật và kỹ thuật cơ bản.',
    starting_elo: ELO_BANDS[0].seedElo,
    legacy_skill_label: 'beginner',
  },
  {
    id: 'pvna_2',
    title: '2.6',
    subtitle: 'Nắm vững cơ bản',
    pvna: '2.6 - 3.0',
    description: 'Đã nắm luật, bắt đầu chơi ổn định và vào nhịp.',
    starting_elo: ELO_BANDS[1].seedElo,
    legacy_skill_label: 'basic',
  },
  {
    id: 'pvna_3',
    title: '3.1',
    subtitle: 'Vào nhịp thi đấu',
    pvna: '3.1 - 3.5',
    description: 'Chơi đều, dink tốt, biết sử dụng chiến thuật cơ bản.',
    starting_elo: ELO_BANDS[2].seedElo,
    legacy_skill_label: 'intermediate',
  },
  {
    id: 'pvna_4',
    title: '3.6',
    subtitle: 'Kiểm soát trận đấu',
    pvna: '3.6 - 4.5',
    description: 'Kỹ thuật tốt, xử lý tình huống linh hoạt, nhịp độ cao.',
    starting_elo: ELO_BANDS[3].seedElo,
    legacy_skill_label: 'intermediate',
  },
  {
    id: 'pvna_5',
    title: '4.6',
    subtitle: 'Xử lý điêu luyện',
    pvna: '4.6 - 5.2',
    description: 'Xử lý ổn định dưới áp lực, chiến thuật chuyên sâu.',
    starting_elo: ELO_BANDS[4].seedElo,
    legacy_skill_label: 'advanced',
  },
  {
    id: 'pvna_6',
    title: '5.5+',
    subtitle: 'Trình độ đỉnh cao',
    pvna: '5.3+',
    description: 'Trình độ thi đấu chuyên nghiệp, kỹ thuật hoàn hảo.',
    starting_elo: ELO_BANDS[5].seedElo,
    legacy_skill_label: 'advanced',
  },
]

export function getSkillLevelById(levelId?: string | null) {
  if (!levelId) return null
  return SKILL_ASSESSMENT_LEVELS.find((item) => item.id === levelId) ?? null
}

export function getSkillLevelFromLegacyLabel(skillLabel?: string | null) {
  const band = getEloBandByLegacySkillLabel(skillLabel)
  return getSkillLevelById(band.levelId) ?? SKILL_ASSESSMENT_LEVELS[0]
}

export function getSkillLevelFromTier(skillTier?: string | null) {
  const band = getEloBandByTier(skillTier)
  return getSkillLevelById(band?.levelId) ?? null
}

export function getSkillLevelFromPlayer(
  player?: {
    self_assessed_level?: string | null
    skill_tier?: string | null
    current_elo?: number | null
    elo?: number | null
    skill_label?: string | null
  } | null,
) {
  const byId = getSkillLevelById(player?.self_assessed_level)
  if (byId) {
    return byId
  }

  const byTier = getSkillLevelFromTier(player?.skill_tier)
  if (byTier) {
    return byTier
  }

  const byElo = getSkillLevelFromElo(player?.current_elo ?? player?.elo)
  if (byElo) {
    return byElo
  }

  const byLegacy = getSkillLevelFromLegacyLabel(player?.skill_label)
  return byLegacy
}

export function getSkillLevelFromElo(elo?: number | null) {
  if (elo == null) return null
  const band = getEloBandForElo(elo)
  return getSkillLevelById(band?.levelId) ?? SKILL_ASSESSMENT_LEVELS[0]
}

export function getSkillLevelFromEloRange(eloMin: number, eloMax: number) {
  const band = getEloBandForSessionRange(eloMin, eloMax)
  return getSkillLevelById(band?.levelId) ?? SKILL_ASSESSMENT_LEVELS[0]
}

export function pvnaToElo(pvna: number): number {
  // New standardized scale: 2.0 -> 1000, 5.5 -> 2500
  // Slope: (2500 - 1000) / (5.5 - 2.0) = 428.57
  return Math.round(1000 + (pvna - 2.0) * 428.57)
}

export function eloToPvna(elo: number): number {
  return (elo - 1000) / 428.57 + 2.0
}

export function getSessionSkillLabel(eloMin: number, eloMax: number) {
  // Use the established PVNA logic from the engine-spec
  // Male (Nam) floor is 2.6, Female (Nu) floor is 2.1 (0.5 diff)
  const getNam = (e: number) => Math.round(((e - 1000) / 517.24 + 2.6) * 10) / 10
  const getNu = (e: number) => Math.round((getNam(e) - 0.5) * 10) / 10
  
  const minNam = getNam(eloMin)
  const maxNam = getNam(eloMax)
  const minNu = getNu(eloMin)
  const maxNu = getNu(eloMax)
  
  const formatRange = (min: number, max: number) => {
    if (max >= 5.5) return `${min.toFixed(1)}+`
    if (Math.abs(min - max) < 0.05) return min.toFixed(1)
    return `${min.toFixed(1)}-${max.toFixed(1)}`
  }

  const labelNam = formatRange(minNam, maxNam)
  const labelNu = formatRange(minNu, maxNu)

  return `Trình ${labelNam} (Nam) / ${labelNu} (Nữ)`
}

export function getShortSkillLabel(level?: SkillAssessmentLevel | null) {
  return getShortLabelForLevelId(level?.id)
}

export function getSkillScoreFromLevelId(levelId?: string | null) {
  const level = getSkillLevelById(levelId)
  if (!level) return null
  return SKILL_ASSESSMENT_LEVELS.findIndex((item) => item.id === level.id) + 1
}

export function getSkillScoreFromLegacyLabel(skillLabel?: string | null) {
  const level = getSkillLevelFromLegacyLabel(skillLabel)
  return SKILL_ASSESSMENT_LEVELS.findIndex((item) => item.id === level.id) + 1
}

export function getSkillScoreFromPlayer(
  player?: {
    self_assessed_level?: string | null
    skill_tier?: string | null
    current_elo?: number | null
    elo?: number | null
    skill_label?: string | null
  } | null,
) {
  const level = getSkillLevelFromPlayer(player)
  return level ? SKILL_ASSESSMENT_LEVELS.findIndex((item) => item.id === level.id) + 1 : null
}

export async function fetchFavoriteCourts(ids?: string[] | null) {
  const courtIds = (ids ?? []).filter(Boolean)
  if (!courtIds.length) return []

  const { data, error } = await supabase.from('courts').select('id, name, district, city').in('id', courtIds)
  if (error) throw error

  const order = new Map(courtIds.map((id, index) => [id, index]))
  return [...(data ?? [])].sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
}
