import { format, isToday, isTomorrow } from 'date-fns'
import { vi } from 'date-fns/locale/vi'

const AVATAR_COLORS = [
  { bg: '#E1F5EE', fg: '#0F6E56' },
  { bg: '#FAECE7', fg: '#993C1D' },
  { bg: '#FAEEDA', fg: '#854F0B' },
  { bg: '#EDE4FE', fg: '#5B21B6' },
  { bg: '#DBF5EA', fg: '#0F6E56' },
] as const

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

export function formatTimeRange(startTime: Date, endTime: Date): string {
  const start = `${pad2(startTime.getHours())}:${pad2(startTime.getMinutes())}`
  const end = `${pad2(endTime.getHours())}:${pad2(endTime.getMinutes())}`
  return `${start}–${end}`
}

export function formatVND(value: number): string {
  if (value <= 0) return 'Miễn phí'
  return `${Math.round(value / 1000)}K`
}

export function formatDistance(distanceKm?: number): string {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) {
    return ''
  }

  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`
  }

  return `${distanceKm.toFixed(1)}km`
}

export function formatRelativeDate(startTime: Date): string {
  if (isToday(startTime)) {
    return 'Hôm nay'
  }

  if (isTomorrow(startTime)) {
    return 'Ngày mai'
  }

  return format(startTime, 'EEEE, dd/MM', { locale: vi })
}

export function getCourtNameSize(name: string): number {
  const length = name.trim().length
  if (length <= 18) return 26
  if (length <= 28) return 22
  return 18
}

export function getAvatarColor(userId: string): { bg: string; fg: string } {
  const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  return { bg: color.bg, fg: color.fg }
}
