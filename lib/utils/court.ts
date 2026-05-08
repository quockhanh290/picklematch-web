/**
 * Helper to check if a court is currently open based on its operating hours.
 * Assumes ICT (Vietnam) timezone for the current time.
 */
export function isCurrentlyOpen(openStr?: string | null, closeStr?: string | null): boolean {
  if (!openStr || !closeStr) return true // Default to open if no data

  try {
    // Get current time in ICT (UTC+7)
    const now = new Date()
    const utc = now.getTime() + now.getTimezoneOffset() * 60000
    const ict = new Date(utc + 3600000 * 7)
    
    const currentMinutes = ict.getHours() * 60 + ict.getMinutes()

    const [openH, openM] = openStr.split(':').map(Number)
    const [closeH, closeM] = closeStr.split(':').map(Number)

    const openMinutes = openH * 60 + openM
    const closeMinutes = closeH * 60 + closeM

    if (closeMinutes < openMinutes) {
      // Overnight range, e.g., 06:00 to 02:00
      return currentMinutes >= openMinutes || currentMinutes <= closeMinutes
    }

    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes
  } catch (e) {
    console.error('Error calculating open status:', e)
    return true
  }
}
