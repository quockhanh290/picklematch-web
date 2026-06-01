import { SCREEN_FONTS } from '@/constants/typography'
import type { Match, RoundStatus, SessionRoundRow, SessionState } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { eloToPvna } from '@/lib/skillAssessment'

export function formatNumber(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function getPlayerPvna(player?: ArrangementPlayer | null): number | null {
  if (player?.pvna != null) return Number(player.pvna)
  if (player?.elo != null) return eloToPvna(Number(player.elo))
  return null
}

export function repeatRiskLabel(risk: string) {
  if (risk === 'low') return 'thấp'
  if (risk === 'medium') return 'vừa'
  if (risk === 'high') return 'cao'
  if (risk === 'extreme') return 'rất cao'
  return risk
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'P'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

export function getTeamPvna(team: [string, string], state: SessionState) {
  return team.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 3.0), 0)
}

const TEST_PLAYER_DISPLAY_NAMES = [
  'Minh Anh',
  'Gia Bao',
  'Thanh Lam',
  'Quoc Huy',
  'Ngoc Linh',
  'Duy Khang',
  'Hoang Nam',
  'Tue Minh',
  'Bao Chau',
  'Khanh Vy',
  'Anh Khoa',
  'Nhat Minh',
  'Thien An',
  'Phuong Nhi',
  'Duc Huy',
  'Lan Anh',
  'Huu Phuc',
  'Mai Chi',
  'Gia Han',
  'Minh Quan',
  'Tuan Kiet',
  'Ha Linh',
  'Quang Minh',
  'Bao Ngoc',
  'Thanh Phong',
  'Kim Anh',
  'Gia Khue',
  'Nam Phuong',
  'Hoai An',
  'Dinh Khoa',
  'My Linh',
  'Phuc An',
  'Dang Khoa',
  'Nhu Y',
  'Viet Anh',
  'Minh Thu',
  'Hai Dang',
  'Tu Anh',
  'Quynh Nhu',
  'Bao Long',
]

function displayNameForTestPlayer(name: string) {
  const match = /^P(\d+)$/.exec(name.trim())
  if (!match) return name
  const index = Math.max(0, Number(match[1]) - 1) % TEST_PLAYER_DISPLAY_NAMES.length
  return TEST_PLAYER_DISPLAY_NAMES[index]
}

export function playerName(playerId: string, playersById: Map<string, ArrangementPlayer>) {
  const name = playersById.get(playerId)?.name
  if (name) return displayNameForTestPlayer(name)
  return playersById.get(playerId)?.name ?? 'Người chơi'
}

export interface RawRoundRow {
  id: string
  session_id: string
  round_no: number
  status: RoundStatus
  matches?: Match[] | null
  resting?: string[] | null
  started_at?: string | null
  ended_at?: string | null
}

export function normalizeRoundRow(row: RawRoundRow): SessionRoundRow {
  return {
    id: row.id,
    session_id: row.session_id,
    round_no: row.round_no,
    status: row.status,
    matches: row.matches ?? [],
    resting: row.resting ?? [],
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
  }
}

export function isRosterSyncEligible(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  if (player.checkInStatus === 'no_show') return false
  return player.checkInStatus === 'present' || player.checkInStatus === 'checked_in' || !player.checkInStatus
}

export function isConfirmedNonNoShow(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  return player.checkInStatus !== 'no_show'
}

export function withWeights(state: SessionState, weights: SessionState['config']['weights']): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      weights,
    },
  }
}

export function ctaTextStyle(color: string, size = 15) {
  return {
    fontFamily: SCREEN_FONTS.cta,
    fontSize: size,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color,
  }
}

export function eyebrowStyle(color: string, size = 10) {
  return {
    fontFamily: SCREEN_FONTS.label,
    fontSize: size,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    color,
  }
}
