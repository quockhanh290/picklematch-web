import { getSessionSkillLabel } from '@/lib/sessionDetail'

export interface SessionDisplayData {
  id: string
  title: string
  courtName: string
  courtAddress: string
  startTime: string
  endTime: string
  confirmedCount: number
  maxPlayers: number
  price: number
  status: 'playing' | 'full' | 'urgent' | 'done' | 'open'
  formatLabel: string
  skillNam: string
  skillNu: string
}

export function parseSessionForCard(session: any, isHost: boolean): SessionDisplayData {
  const startTime = session.start_time || session.slot?.start_time || new Date().toISOString()
  const endTime = session.end_time || session.slot?.end_time || new Date().toISOString()
  
  const courtName = session.court_name || session.slot?.court?.name || 'SÂN PICKLEBALL'
  const address = session.court_address || session.slot?.court?.address || ''
  
  const ownerSessions = session.owner_sessions
  const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
  const formatType = ownerDetails.format_type || session.format_type || 'social'
  const fmt = formatType.toLowerCase()
  
  const formatLabel = fmt === 'round_robin' ? 'ROUND ROBIN' : (fmt === 'open_play' ? 'OPEN PLAY' : 'GIAO LƯU SOCIAL')
  const title = session.title || formatLabel

  const confirmedCount = Array.isArray(session.session_players)
    ? session.session_players.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length
    : (session.player_count || 0)
  const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
  const price = ownerDetails.format_metadata?.cost_per_person ?? ownerDetails.total_cost ?? session.total_cost ?? 0
  
  const rawSkill = getSessionSkillLabel(session.elo_min, session.elo_max) || ''
  let skillNam = ''
  let skillNu = ''
  
  if (rawSkill.includes('/')) {
    const parts = rawSkill.split('/')
    skillNam = parts[0].replace('♂', '').replace(/\(Nam\)|\(nam\)|Trình|trình/ig, '').trim()
    skillNu = (parts[1] || '').replace('♀', '').replace(/\(Nữ\)|\(nữ\)|Trình|trình/ig, '').trim()
  } else {
    skillNam = rawSkill.replace('♂', '').replace('♀', '').replace(/\(Nam\)|\(nam\)|\(Nữ\)|\(nữ\)|Trình|trình/ig, '').trim()
  }

  // Calculate status
  const startDate = new Date(startTime)
  const endDate = new Date(endTime)
  const now = Date.now()
  const isPastEnd = endDate.getTime() <= now
  
  const isPlaying = session.status === 'playing' && !isPastEnd
  const isCancelled = session.status === 'cancelled'
  const isDone = ['completed', 'finished', 'archived', 'done'].includes(session.status) || (isPastEnd && !isCancelled)
  
  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1
  const isUnderfilled = fillRatio < 0.6 && !isDone && !isPlaying && !isCancelled
  const isWithin24h = startDate.getTime() > now && (startDate.getTime() - now) < (24 * 3600000)
  const isUrgent = isUnderfilled && isWithin24h

  let parsedStatus: SessionDisplayData['status'] = 'open'
  if (isDone || isCancelled) parsedStatus = 'done'
  else if (isPlaying) parsedStatus = 'playing'
  else if (isFull) parsedStatus = 'full'
  else if (isUrgent) parsedStatus = 'urgent'

  return {
    id: session.id,
    title,
    courtName,
    courtAddress: address,
    startTime,
    endTime,
    confirmedCount,
    maxPlayers,
    price: Math.round(price / 1000), // convert to K
    status: parsedStatus,
    formatLabel,
    skillNam,
    skillNu
  }
}
