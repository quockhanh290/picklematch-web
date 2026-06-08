import { getSkillLevelFromEloRange } from '@/lib/skillAssessment'
import { Session } from './types'
import { hexToRgb, withAlpha, normalizeText } from '@/lib/utils/ui'

export { hexToRgb, withAlpha, normalizeText }

export function extractDistrict(address?: string | null): string | null {
  if (!address) return null
  const match = address.match(/(?:Quận|Huyện)\s+[^,\n]+/i)
  return match ? match[0].trim() : null
}

export function buildSearchIndex(session: Session) {
  const court = session.slot?.court
  const skill = getSkillLevelFromEloRange(session.elo_min, session.elo_max)
  const rawText = [court?.name, court?.address, court?.city, skill.title, session.host?.name]
    .filter(Boolean)
    .join(' ')
  
  return normalizeText(rawText)
}

export function computeMatchScore(session: Session, rescueMode: boolean, level3Mode: boolean) {
  const slotsLeft = Math.max(session.max_players - session.player_count, 0)
  const startAt = new Date(session.slot?.start_time ?? 0).getTime()
  const hoursUntilStart = (startAt - Date.now()) / 3600000
  const skill = getSkillLevelFromEloRange(session.elo_min, session.elo_max)
  let score = 74
  if (session.court_booking_status === 'confirmed') score += 10
  if (slotsLeft > 0) score += 6
  if (slotsLeft === 1) score += 4
  if (hoursUntilStart >= 0 && hoursUntilStart <= 24) score += 4
  if (hoursUntilStart > 24 && hoursUntilStart <= 72) score += 2
  if (rescueMode && slotsLeft <= 2) score += 6
  if (level3Mode && skill.id === 'pvna_3') score += 8
  return Math.max(78, Math.min(score, 99))
}

export function getCardStatus(session: Session): 'open' | 'starting_soon' | 'full' | 'past' {
  const startTime = new Date(session.slot?.start_time ?? 0).getTime()
  const minutesToStart = (startTime - Date.now()) / 60000
  if (session.status === 'closed' || session.status === 'completed' || startTime < Date.now()) return 'past'
  if (session.player_count >= session.max_players) return 'full'
  if (minutesToStart >= 0 && minutesToStart <= 30) return 'starting_soon'
  return 'open'
}

export function formatDateTime(start: string, end: string) {
  const s = new Date(start)
  const e = new Date(end)
  const pad = (v: number) => v.toString().padStart(2, '0')
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][s.getDay()]
  return {
    dayLabel: `${weekday} ${pad(s.getDate())}/${pad(s.getMonth() + 1)}`,
    timeLabel: `${pad(s.getHours())}:${pad(s.getMinutes())} - ${pad(e.getHours())}:${pad(e.getMinutes())}`,
  }
}
