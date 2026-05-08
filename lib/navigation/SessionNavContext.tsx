import  { createContext, useContext } from 'react'

export interface SessionNavigation {
  // Session details & actions
  onOpenSession: (id: string) => void
  onEditSession: (id: string) => void
  onViewMatchResult: (id: string) => void
  onRateSession: (id: string) => void
  onConfirmResult: (id: string) => void
  onReviewSession: (id: string) => void
  
  // Related entities
  onOpenPlayerProfile: (id: string) => void
  onOpenCourt: (id: string) => void
}

export const SessionNavContext = createContext<SessionNavigation | null>(null)

export const useSessionNav = () => {
  const context = useContext(SessionNavContext)
  if (!context) {
    throw new Error('useSessionNav must be used within a SessionNavProvider')
  }
  return context
}
