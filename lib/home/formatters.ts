import { format } from 'date-fns'
import { vi } from 'date-fns/locale/vi'
import type { HomeSessionRecord, HomeSessionRelation, HomeSessionRecordRaw } from './types'
import { STRINGS } from '@/constants/strings'

export const COURT_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1547347298-4074fc3086f0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1518604666860-9ed391f76460?auto=format&fit=crop&w=1200&q=80',
]

export function normalizeRelation<T>(value: HomeSessionRelation<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

export function normalizeHomeSessionRecord(session: HomeSessionRecordRaw): HomeSessionRecord {
  const slot = normalizeRelation(session.slot)

  return {
    ...session,
    host: normalizeRelation(session.host),
    slot: slot
      ? {
          ...slot,
          court: normalizeRelation(slot.court),
        }
      : null,
    session_players: (session.session_players ?? []).map((sessionPlayer) => ({
      ...sessionPlayer,
      player: normalizeRelation(sessionPlayer.player),
    })),
  }
}

export function formatTimeLabel(startTime: string, endTime: string) {
  const startDate = new Date(startTime)
  const endDate = new Date(endTime)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return STRINGS.date.unknown
  }

  const dateLabel = format(startDate, 'EEEE, dd/MM', { locale: vi })
  const startClock = format(startDate, 'HH:mm')
  const endClock = format(endDate, 'HH:mm')

  return `${dateLabel} • ${startClock} - ${endClock}`
}

export function formatPendingResultTimeLabel(endTime: string) {
  const endDate = new Date(endTime)
  if (Number.isNaN(endDate.getTime())) {
    return STRINGS.date.finished
  }

  const dateLabel = format(endDate, 'EEEE, dd/MM', { locale: vi })
  const timeLabel = format(endDate, 'HH:mm')
  return `${STRINGS.date.ended} ${dateLabel} • ${timeLabel}`
}

export function formatPriceLabel(totalPrice: number, maxPlayers: number) {
  const pricePerPlayer = Math.round(totalPrice / Math.max(maxPlayers, 1))
  if (pricePerPlayer <= 0) return 'Miễn phí'
  if (pricePerPlayer >= 1000) {
    const thousands = pricePerPlayer / 1000
    return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}K`
  }
  return `${pricePerPlayer}đ`
}

export function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function getStatusLabel(
  bookingStatus: HomeSessionRecord['court_booking_status'],
  sessionStatus: HomeSessionRecord['status'],
) {
  return bookingStatus === 'confirmed' ? STRINGS.session.booking.confirmed : STRINGS.session.booking.unconfirmed
}

export function isWithinNext24Hours(startTime: string) {
  const startMs = Date.parse(startTime)
  if (Number.isNaN(startMs)) {
    return false
  }

  const nowMs = Date.now()
  const diffMs = startMs - nowMs
  return diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000
}

export function isWithinNext12Hours(startTime: string) {
  const startMs = Date.parse(startTime)
  if (Number.isNaN(startMs)) {
    return false
  }

  const nowMs = Date.now()
  const diffMs = startMs - nowMs
  return diffMs > 0 && diffMs <= 12 * 60 * 60 * 1000
}

export function formatCountdownLabelFromStartTime(startTime: string) {
  const diffMs = Math.max(Date.parse(startTime) - Date.now(), 0)
  const totalMinutes = Math.floor(diffMs / (60 * 1000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const pad = (value: number) => value.toString().padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}`
}
