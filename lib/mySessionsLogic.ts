export type SessionRequestStatus = 'pending' | 'accepted' | 'rejected' | null
export type SessionRole = 'host' | 'player'

export type MySessionLike = {
  role: SessionRole
  request_status: SessionRequestStatus
  status: string
}

export function resolveTab(session: MySessionLike): 'upcoming' | 'pending' | 'history' {
  if (session.role === 'host' && session.request_status === 'pending') return 'pending'
  if (session.role === 'player' && session.request_status === 'pending') return 'pending'
  if (session.status === 'done' || session.status === 'cancelled') return 'history'
  return 'upcoming'
}
