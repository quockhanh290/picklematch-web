export function formatDatePart(value: string) {
  const date = new Date(value)
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()]
  const day = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`
  return `${weekday} ${day}`
}

export function formatTimeRange(start: string, end: string) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const startHour = startDate.getHours().toString().padStart(2, '0')
  const startMinute = startDate.getMinutes().toString().padStart(2, '0')
  const endHour = endDate.getHours().toString().padStart(2, '0')
  const endMinute = endDate.getMinutes().toString().padStart(2, '0')
  return `${startHour}:${startMinute} - ${endHour}:${endMinute}`
}

export function getMonthKey(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-')
  return `Tháng ${month}/${year}`
}
