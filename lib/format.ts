export function pad(v: number): string {
  return v.toString().padStart(2, '0')
}

/**
 * Formats a date to DD/MM/YYYY
 */
export function formatDate(dateStr: string | Date): string {
  const d = new Date(dateStr)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Formats a time to HH:mm
 */
export function formatTime(dateStr: string | Date): string {
  const d = new Date(dateStr)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Formats a date and time to DD/MM/YYYY HH:mm
 */
export function formatDateTime(dateStr: string | Date): string {
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`
}

/**
 * Formats a relative date (Vừa xong, x phút trước, ...)
 */
export function timeAgo(dateStr: string | Date): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Vừa xong'
  if (mins < 60) return `${mins} phút trước`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} giờ trước`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} ngày trước`
  return formatDate(dateStr)
}

/**
 * Returns a Vietnamese weekday label
 */
export function getWeekday(dateStr: string | Date): string {
  const d = new Date(dateStr)
  return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()]
}
