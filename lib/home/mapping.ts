import { getEloBandForSessionRange } from '@/lib/eloSystem'
import type { SkillAssessmentLevel } from '@/lib/skillAssessment'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import type { HomeSessionRecord, MatchSession, Player, Host } from './types'
import {
  formatTimeLabel,
  formatPriceLabel,
  getInitials,
  getStatusLabel,
  isWithinNext24Hours,
  formatCountdownLabelFromStartTime,
} from './formatters'

export function getLevelIdFromSession(session: Pick<HomeSessionRecord, 'elo_min' | 'elo_max' | 'host'>): SkillAssessmentLevel['id'] {
  if (Number.isFinite(session.elo_min) && Number.isFinite(session.elo_max)) {
    return getEloBandForSessionRange(session.elo_min, session.elo_max).levelId
  }

  const hostLevel = session.host?.self_assessed_level as SkillAssessmentLevel['id'] | undefined
  if (hostLevel) return hostLevel
  return 'pvna_1'
}

export function getLivePlayerBadge(player?: { reliability_score?: number | null }): Player['badge'] {
  return (player?.reliability_score ?? 0) >= 95 ? 'trusted' : 'streak'
}

export function getLiveHostRating(session: HomeSessionRecord, hostAverageRating?: number | null) {
  if (hostAverageRating != null && hostAverageRating > 0) return Number(hostAverageRating.toFixed(1))

  const hostReputation = session.host?.host_reputation ?? 0
  const reliability = session.host?.reliability_score ?? 90
  const normalized = 4.2 + Math.min(hostReputation, 20) * 0.03 + Math.min(Math.max(reliability - 85, 0), 15) * 0.01
  return Math.min(5, Number(normalized.toFixed(1)))
}

export function buildLiveHostVibe(session: HomeSessionRecord, slotsLeft: number) {
  if (session.court_booking_status === 'confirmed' && slotsLeft <= 1) return 'Host đã chốt sân, vào là ghép nhanh'
  if ((session.host?.reliability_score ?? 0) >= 95) return 'Host uy tín, phản hồi thường rất nhanh'
  if (slotsLeft <= 2) return 'Host đang ưu tiên chốt đội hình sớm'
  return 'Host mở kèo rõ ràng, dễ theo và dễ ghép'
}

export function computeLiveMatchScore(session: HomeSessionRecord, viewerElo?: number | null, joined?: boolean) {
  const activePlayers = session.session_players.filter((player) => player.status !== 'rejected').length
  const slotsLeft = Math.max(session.max_players - activePlayers, 0)
  const midpoint = Math.round((session.elo_min + session.elo_max) / 2)
  const eloGap = viewerElo == null ? 80 : Math.abs(viewerElo - midpoint)

  let score = 72
  if (session.court_booking_status === 'confirmed') score += 10
  if (isWithinNext24Hours(session.slot?.start_time ?? '')) score += 7
  if (slotsLeft > 0 && slotsLeft <= 2) score += 8
  if (joined) score += 6
  if (eloGap <= 60) score += 10
  else if (eloGap <= 140) score += 6
  else if (eloGap <= 220) score += 3

  return Math.max(78, Math.min(score, 99))
}

export function mapLiveSessionToMatchSession(
  session: HomeSessionRecord,
  options?: { viewerId?: string | null; viewerElo?: number | null; hostAverageRating?: number | null; urgent?: boolean },
): MatchSession {
  const levelId = getLevelIdFromSession(session)
  const joined =
    (options?.viewerId != null && session.host_id === options.viewerId) ||
    session.session_players.some((player) => player.player_id === options?.viewerId)
  
  // Only count confirmed players who have valid player profile data
  const confirmedParticipants = session.session_players.filter(
    (sp) => sp.status === 'confirmed' && sp.player
  )
  
  // Identify unique player IDs to avoid double counting the host
  const participantIds = new Set(confirmedParticipants.map(p => p.player_id))
  const isHostInParticipants = participantIds.has(session.host_id)
  
  // Calculate active players ensuring host is always included
  const activePlayers = isHostInParticipants ? participantIds.size : participantIds.size + 1
  const slotsLeft = Math.max(session.max_players - activePlayers, 0)

  // Build the players display list (avatars), ensuring host is included
  let displayPlayers = confirmedParticipants.map(sp => ({
    id: sp.player?.id ?? sp.player_id,
    name: sp.player?.name ?? 'Người chơi',
    initials: getInitials(sp.player?.name ?? 'Người chơi'),
    badge: getLivePlayerBadge(sp.player ?? undefined),
  }))

  if (!isHostInParticipants && session.host) {
    displayPlayers.unshift({
      id: session.host.id,
      name: session.host.name,
      initials: getInitials(session.host.name),
      badge: getLivePlayerBadge(session.host as any),
    })
  }

  const players = displayPlayers.slice(0, 4)
  const urgent = options?.urgent ?? slotsLeft <= 2
  const court = session.slot?.court

  const isEnded = session.status === 'done' || session.status === 'pending_completion' || session.status === 'pending_results' || session.status === 'cancelled'
  const isEven = activePlayers % 2 === 0
  const isValidCount = activePlayers >= 2 && isEven && activePlayers <= session.max_players
  const isInvalidPlayerCount = isEnded && !isValidCount

  let statusLabel: string = getStatusLabel(session.court_booking_status, session.status)
  if (isInvalidPlayerCount && session.status !== 'cancelled') {
    statusLabel = 'Hủy - Thiếu người'
  } else if (session.status === 'cancelled') {
    statusLabel = 'Đã hủy'
  }

  return {
    id: session.id,
    title: urgent ? 'Cần chốt đội hình' : `Kèo ${getSessionSkillLabel(session.elo_min, session.elo_max).toLowerCase()}`,
    bookingId: `BK-${session.id.slice(0, 6).toUpperCase()}`,
    courtName: court?.name ?? 'Kèo Pickleball',
    address: [court?.address, court?.city].filter(Boolean).join(', '),
    matchScore: computeLiveMatchScore(session, options?.viewerElo, joined),
    skillLabel: getSessionSkillLabel(session.elo_min, session.elo_max),
    timeLabel: formatTimeLabel(session.slot?.start_time ?? new Date().toISOString(), session.slot?.end_time ?? new Date().toISOString()),
    startTime: session.slot?.start_time,
    endTime: session.slot?.end_time,
    priceLabel: session.total_cost 
      ? formatPriceLabel(session.total_cost, 1) 
      : formatPriceLabel(session.slot?.price ?? 0, session.max_players),
    openSlotsLabel: slotsLeft === 0 ? 'Đã đủ người' : urgent ? `Thiếu ${slotsLeft} người` : `${slotsLeft} chỗ trống`,
    slotsLeft,
    statusLabel,
    countdownLabel: isWithinNext24Hours(session.slot?.start_time ?? '') ? formatCountdownLabelFromStartTime(session.slot?.start_time ?? '') : undefined,
    isRanked: session.is_ranked ?? true,
    activePlayers,
    maxPlayers: session.max_players,
    levelId,
    host: {
      id: session.host?.id ?? session.host_id,
      name: session.host?.name ?? 'Ẩn danh',
      initials: getInitials(session.host?.name ?? 'Ẩn danh'),
      rating: getLiveHostRating(session, options?.hostAverageRating),
      vibe: buildLiveHostVibe(session, slotsLeft),
    },
    hostInitials: getInitials(session.host?.name ?? ''),
    hostRating: getLiveHostRating(session, options?.hostAverageRating),
    players,
    urgent,
    joined,
    isBooked: session.court_booking_status === 'confirmed',
    isHot: urgent,
    isHighlyRated: getLiveHostRating(session, options?.hostAverageRating) >= 4.8,
    courtBookingConfirmed: session.court_booking_status === 'confirmed',
    court_thumbnail_url: court?.thumbnail_url,
    court_rating: court?.rating,
    court: court,
  }
}

export function buildMockPlayers(count: number): Player[] {
  const names = ['Nam Long', 'Quang Minh', 'Phuong Anh', 'Bao Tran', 'Khanh Linh', 'Hoang Vu', 'Gia Han', 'Huy Khoa']

  return Array.from({ length: count }).map((_, index) => {
    const name = names[index % names.length]
    return {
      id: `mock-player-${index + 1}`,
      name,
      initials: getInitials(name),
      badge: index % 2 === 0 ? 'trusted' : 'streak',
    }
  })
}

export function buildSkillLevelPreviewSessions(): MatchSession[] {
  const mockHost: Host = {
    id: 'mock-host-minh-quan',
    name: 'Host Minh Quan',
    initials: 'MQ',
    rating: 4.8,
    vibe: 'Host mở kèo rõ ràng, dễ theo và dễ ghép',
  }

  const scenarios = [
    {
      id: 'mock-level-1-open',
      courtName: 'Tao Dan Rookie Court',
      address: '55C Nguyen Thi Minh Khai, Ben Thanh, Q1, TP.HCM',
      timeLabel: '18:00 - 20:00',
      priceLabel: '70K',
      levelId: 'pvna_1' as const,
      statusLabel: 'Chưa đặt sân',
      isRanked: false,
      urgent: false,
      activePlayers: 2,
      maxPlayers: 6,
    },
    {
      id: 'mock-level-2-open',
      courtName: 'Phu Tho Basics Arena',
      address: '219 Ly Thuong Kiet, Ward 15, Q11, TP.HCM',
      timeLabel: '07:00 - 09:00',
      priceLabel: '85K',
      levelId: 'pvna_2' as const,
      statusLabel: 'Đã đặt sân',
      isRanked: true,
      urgent: false,
      activePlayers: 4,
      maxPlayers: 6,
    },
    {
      id: 'mock-level-3-urgent',
      courtName: 'Rach Mieu Match Point',
      address: '1 Hoa Su, Ward 7, Phu Nhuan, TP.HCM',
      timeLabel: '20:30 - 22:00',
      priceLabel: '95K',
      levelId: 'level_1' as const,
      statusLabel: 'Đã đặt sân',
      isRanked: false,
      urgent: true,
      activePlayers: 5,
      maxPlayers: 6,
    },
    {
      id: 'mock-level-4-ranked',
      courtName: 'Celadon Medal Hub',
      address: '88 N1, Son Ky, Tan Phu, TP.HCM',
      timeLabel: '06:00 - 08:00',
      priceLabel: '115K',
      levelId: 'pvna_4' as const,
      statusLabel: 'Đã đặt sân',
      isRanked: true,
      urgent: false,
      activePlayers: 6,
      maxPlayers: 8,
    },
    {
      id: 'mock-level-5-ranked-urgent',
      courtName: 'Global Elite Championship Court',
      address: 'Do Xuan Hop, An Phu, Thu Duc, TP.HCM',
      timeLabel: '19:00 - 21:00',
      priceLabel: '140K',
      levelId: 'pvna_5' as const,
      statusLabel: 'Đã đặt sân',
      isRanked: true,
      urgent: true,
      activePlayers: 5,
      maxPlayers: 6,
    },
  ]

  return scenarios.map((session) => ({
    id: session.id,
    title: session.urgent ? 'Cần chốt đội hình' : 'Kèo phù hợp',
    bookingId: `BK-${session.id.slice(0, 6).toUpperCase()}`,
    courtName: session.courtName,
    address: session.address,
    matchScore: session.urgent ? 94 : session.isRanked ? 91 : 88,
    skillLabel: getSessionSkillLabel(1000, 3000), // Mock values
    timeLabel: session.timeLabel,
    priceLabel: session.priceLabel,
    openSlotsLabel: `${Math.max(session.maxPlayers - session.activePlayers, 0)} chỗ trống`,
    slotsLeft: session.maxPlayers - session.activePlayers,
    statusLabel: session.statusLabel,
    isRanked: session.isRanked,
    activePlayers: session.activePlayers,
    maxPlayers: session.maxPlayers,
    levelId: session.levelId,
    host: mockHost,
    hostInitials: mockHost.initials,
    hostRating: mockHost.rating,
    players: buildMockPlayers(session.activePlayers),
    urgent: session.urgent,
    joined: false,
    isBooked: session.statusLabel === 'Đã đặt sân',
    isHot: session.urgent,
    isHighlyRated: mockHost.rating >= 4.8,
  }))
}

export function buildUpcomingMatchPreviewSession(): MatchSession {
  const host: Host = {
    id: 'mock-host-gia-huy',
    name: 'Host Gia Huy',
    initials: 'GH',
    rating: 4.9,
    vibe: 'Host đúng giờ, tổ chức kèo nhanh và rõ ràng',
  }

  const levelId: SkillAssessmentLevel['id'] = 'pvna_1'

  return {
    id: 'mock-upcoming-hero',
    title: 'Kèo sắp diễn ra',
    bookingId: 'BK-HERO01',
    courtName: 'Văn Thánh Riverside Court',
    address: '561A Dien Bien Phu, Binh Thanh, TP.HCM',
    matchScore: 93,
    skillLabel: getSessionSkillLabel(1000, 1100),
    timeLabel: 'Hôm nay • 19:30 - 21:00',
    priceLabel: '95K',
    openSlotsLabel: '2 chỗ trống',
    slotsLeft: 2,
    statusLabel: 'Đã đặt sân',
    countdownLabel: 'Bắt đầu sau 2 giờ 15 phút',
    isRanked: true,
    activePlayers: 4,
    maxPlayers: 6,
    levelId,
    host,
    hostInitials: host.initials,
    hostRating: host.rating,
    players: buildMockPlayers(4),
    urgent: false,
    joined: true,
    isBooked: true,
    isHot: false,
    isHighlyRated: true,
  }
}
