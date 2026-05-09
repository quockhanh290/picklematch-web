import {
  getEloBandByLevelId,
  getEloBandByLegacySkillLabel,
  getEloBandForElo,
  getShortLabelForLevelId,
} from '@/lib/eloSystem'
import type { EloLevelId } from '@/lib/eloSystem'

export type EloPlayer = {
  elo?: number | null
  current_elo?: number | null
}

export type ReliablePlayer = EloPlayer & {
  reliability_score?: number | null
  sessions_joined?: number | null
  no_show_count?: number | null
}

export type SkillPlayer = EloPlayer & {
  self_assessed_level?: string | null
  skill_label?: string | null
}

export type ArrangementSourcePlayer = ReliablePlayer &
  SkillPlayer & {
    name?: string | null
    gender?: string | null
    pvna?: number | null
  }

export type ArrangementSessionPlayer = {
  player_id: string
  team_no?: number | null
  player?: ArrangementSourcePlayer | null
  status?: string | null
  check_in_status?: string | null
  metadata?: any
}

export type ArrangementHost = ArrangementSourcePlayer & {
  id: string
  name: string
}

export type ArrangementPlayer = {
  id: string
  name: string
  elo: number
  team: number
  reliability: number | null
  levelId: EloLevelId
  skillTag: string
  gender?: string | null
  pvna?: number | null
  status?: string | null
  noShowCount?: number | null
  checkInStatus?: string | null
  metadata?: any
}

export type ArrangementSession = {
  host: ArrangementHost
  session_players: ArrangementSessionPlayer[]
  owner_sessions?: {
    host_is_playing?: boolean
  }
}

export function safeNumber(value?: number | null) {
  return Math.round(value ?? 0)
}

export function getComparableElo(player?: EloPlayer | null) {
  return safeNumber(player?.current_elo ?? player?.elo ?? 0)
}

export function getInitials(name?: string | null) {
  return (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function getReliability(player?: ReliablePlayer | null) {
  if (player?.reliability_score != null) return Math.round(player.reliability_score)
  const joined = player?.sessions_joined ?? 0
  if (!joined) return null
  const noShow = player?.no_show_count ?? 0
  return Math.max(0, Math.min(100, Math.round(((joined - noShow) / joined) * 100)))
}

export function getSkillLevelId(player?: SkillPlayer | null): EloLevelId {
  const levelId = player?.self_assessed_level
  if (levelId) return getEloBandByLevelId(levelId)?.levelId ?? 'level_1'

  const legacy = player?.skill_label
  if (legacy) return getEloBandByLegacySkillLabel(legacy).levelId

  const elo = getComparableElo(player)
  return getEloBandForElo(elo)?.levelId ?? 'level_1'
}

export function getSkillTag(player?: SkillPlayer | null) {
  return getShortLabelForLevelId(getSkillLevelId(player))
}

export { getSessionSkillLabel } from './skillAssessment'

export function formatTimeRange(start: string, end: string) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const weekdays = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
  const dateLabel = `${String(startDate.getDate()).padStart(2, '0')}/${String(startDate.getMonth() + 1).padStart(2, '0')}/${startDate.getFullYear()}`
  const timeLabel = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')} - ${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
  return `${weekdays[startDate.getDay()]}, ${dateLabel} • ${timeLabel}`
}

export function formatPricePerPerson(totalPrice: number, maxPlayers: number) {
  if (!totalPrice || !maxPlayers) return 'Miễn phí'
  const perPerson = Math.ceil(totalPrice / maxPlayers)
  if (perPerson >= 1000) {
    return `${Math.round(perPerson / 1000)}K`
  }
  return `${perPerson}đ`
}

export function buildArrangementPlayers(session: ArrangementSession) {
  const playersById = new Map<string, ArrangementPlayer>()

  const hostIsPlaying = session.owner_sessions?.host_is_playing ?? true
  const hostAlreadyInPlayers = (session.session_players ?? []).some(sp => sp.player_id === session.host.id)

  if (hostIsPlaying || hostAlreadyInPlayers) {
    const hostInPlayers = (session.session_players ?? []).find(sp => sp.player_id === session.host.id)
    playersById.set(session.host.id, {
      id: session.host.id,
      name: session.host.name,
      elo: getComparableElo(session.host),
      reliability: getReliability(session.host),
      levelId: getSkillLevelId(session.host),
      skillTag: getSkillTag(session.host),
      gender: session.host.gender,
      pvna: session.host.pvna,
      team: hostInPlayers?.team_no || 0,
      status: hostInPlayers?.status || 'confirmed',
      noShowCount: session.host.no_show_count,
      checkInStatus: hostInPlayers?.check_in_status,
      metadata: hostInPlayers?.metadata
    })
  }

  for (const entry of session.session_players ?? []) {
    playersById.set(entry.player_id, {
      ...(entry.player as any),
      id: entry.player_id,
      name: entry.player?.name ?? 'Người chơi',
      elo: getComparableElo(entry.player),
      reliability: getReliability(entry.player),
      levelId: getSkillLevelId(entry.player),
      skillTag: getSkillTag(entry.player),
      gender: entry.player?.gender,
      pvna: entry.player?.pvna,
      team: entry.team_no || 0,
      status: entry.status || 'confirmed',
      noShowCount: entry.player?.no_show_count,
      checkInStatus: entry.check_in_status,
      metadata: entry.metadata
    })
  }

  const everyone = Array.from(playersById.values())
  const hasPersistedTeams = (session.session_players ?? []).some((entry) => entry.team_no != null)

  if (hasPersistedTeams) {
    return everyone
  }

  const sorted = [...everyone].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name, 'vi'))
  const teamMap = new Map<string, number>()

  sorted.forEach((player, index) => {
    teamMap.set(player.id, index % 2 === 0 ? 1 : 2)
  })

  return everyone.map((player) => ({
    ...player,
    team: teamMap.get(player.id) ?? 1,
  }))
}

export function autoBalance(players: ArrangementPlayer[]) {
  const sorted = [...players].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name, 'vi'))
  let totalA = 0
  let totalB = 0

  return sorted
    .map((player) => {
      const team: 1 | 2 = totalA <= totalB ? 1 : 2
      if (team === 1) totalA += player.elo
      else totalB += player.elo
      return { ...player, team }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}
