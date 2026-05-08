import {  ShieldCheck, AlertCircle } from 'lucide-react-native'
import { format, isToday, isTomorrow, differenceInMinutes, parseISO, isValid } from 'date-fns'
import { vi } from 'date-fns/locale/vi'
import { AppTheme } from '@/constants/theme'
import { MatchSession } from '@/lib/homeFeed'
import { STRINGS } from '@/constants/strings'


export function getBookingStatusVisual(statusLabel: string) {
  const normalized = statusLabel.toLowerCase()
  const isBooked = normalized.includes('\u0111\u00e3 \u0111\u1eb7t s\u00e2n')
  return {
    Icon: isBooked ? ShieldCheck : AlertCircle,
  }
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function pad2(value: number) {
  return value.toString().padStart(2, '0')
}

export function splitMatchTimeLabel(timeLabel: string) {
  const parts = timeLabel.split(/\u2022/).map((part) => part.trim())
  return {
    datePart: parts.length > 1 ? parts[0] : '',
    timeRange: parts.length > 1 ? parts[1] : timeLabel.trim(),
  }
}

export function parseUpcomingStartDate(timeLabel: string, now: Date) {
  const { datePart, timeRange } = splitMatchTimeLabel(timeLabel)
  const timeMatch = timeRange.match(/(\d{1,2}):(\d{2})/)
  if (!timeMatch) return null

  const start = new Date(now)
  start.setSeconds(0, 0)
  start.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0)

  const normalizedDate = datePart.toLowerCase()
  if (normalizedDate.includes('hôm nay')) {
    return start
  }

  if (normalizedDate.includes('ngày mai')) {
    start.setDate(now.getDate() + 1)
    return start
  }

  const dateMatch = datePart.match(/(\d{1,2})\/(\d{1,2})/)
  if (dateMatch) {
    start.setMonth(Number(dateMatch[2]) - 1, Number(dateMatch[1]))
    if (start.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
      start.setFullYear(start.getFullYear() + 1)
    }
    return start
  }

  return start
}

export function getFullWeekdayLabel(date: Date) {
  return format(date, 'EEEE', { locale: vi })
}

export function getHeaderTimeLabel(startDate: Date | null, now: Date) {
  if (!startDate) return { date: '', countdown: '', isUrgent: false, label: '' }

  const totalMinutes = differenceInMinutes(startDate, now)
  const dateLabel = format(startDate, 'EEEE, dd/MM', { locale: vi }).toUpperCase()

  if (totalMinutes > 24 * 60) {
    return {
      date: dateLabel,
      countdown: '',
      isUrgent: false,
      label: dateLabel,
    }
  }

  let countdown = ''
  if (totalMinutes < 30) {
    countdown = STRINGS.common.countdown.starting_soon
  } else if (totalMinutes < 120) {
    countdown = `${STRINGS.common.countdown.prefix} ${totalMinutes}${STRINGS.common.countdown.minutes_suffix}`
  } else {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    countdown = `${STRINGS.common.countdown.prefix} ${hours}${STRINGS.common.countdown.hours_suffix} ${minutes}${STRINGS.common.countdown.minutes_suffix}`
  }

  return {
    date: dateLabel,
    countdown,
    isUrgent: totalMinutes < 120,
    label: countdown,
  }
}

export function getStartClock(timeRange: string) {
  return timeRange.match(/(\d{1,2}:\d{2})/)?.[1] ?? timeRange
}

export function getStartClockFromDate(date: Date | null, fallback: string) {
  if (!date) return getStartClock(fallback)
  return format(date, 'HH:mm')
}

export function getStartSubLabel(startDate: Date | null, now: Date) {
  if (!startDate) return ''

  const totalMinutes = differenceInMinutes(startDate, now)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.max(1, totalMinutes)

  if (isToday(startDate)) {
    return hours >= 1 ? `${STRINGS.date.today} \u00b7 ${hours}h` : `${STRINGS.date.today} \u00b7 ${minutes}p`
  }

  if (isTomorrow(startDate)) {
    return `${STRINGS.date.tomorrow} \u00b7 ${Math.max(hours, 1)}h`
  }

  return format(startDate, 'EEEE, dd/MM', { locale: vi })
}

export function parseDateOrFallback(value: string | undefined, fallback: Date) {
  if (!value) return fallback
  const parsed = parseISO(value)
  return isValid(parsed) ? parsed : fallback
}

export function parseSessionStartDate(item: MatchSession) {
  return parseDateOrFallback(item.startTime, parseUpcomingStartDate(item.timeLabel, new Date()) ?? new Date())
}

export function parseSessionEndDate(item: MatchSession, startDate: Date) {
  if (item.endTime) {
    const parsed = parseISO(item.endTime)
    if (isValid(parsed)) return parsed
  }

  const { timeRange } = splitMatchTimeLabel(item.timeLabel)
  const matches = [...timeRange.matchAll(/(\d{1,2}):(\d{2})/g)]
  const endMatch = matches[1]
  if (!endMatch) return startDate

  const endDate = new Date(startDate)
  endDate.setHours(Number(endMatch[1]), Number(endMatch[2]), 0, 0)
  return endDate
}

export function formatClock(date: Date) {
  return format(date, 'HH:mm')
}

export function getSuggestedDayInfo(startTime: Date, theme: AppTheme) {
  const dateFormatted = format(startTime, 'dd/MM')

  if (isToday(startTime)) {
    return {
      label: `${STRINGS.date.today}, ${dateFormatted}`,
      badgeLabel: STRINGS.date.today.toUpperCase(),
      badgeColor: theme.primary,
    }
  }

  if (isTomorrow(startTime)) {
    return {
      label: `${STRINGS.date.tomorrow}, ${dateFormatted}`,
      badgeLabel: STRINGS.date.tomorrow.toUpperCase(),
      badgeColor: theme.onSurfaceVariant,
    }
  }

  const label = format(startTime, 'EEEE, dd/MM', { locale: vi })
  return {
    label,
    badgeLabel: label.toUpperCase(),
    badgeColor: theme.outline,
  }
}
