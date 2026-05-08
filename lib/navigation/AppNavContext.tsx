import  { createContext, useContext } from 'react'

export interface AppNavigation {
  onOpenProfile: () => void
  onCreateSession: () => void
  onLogout?: () => void
}

export const AppNavContext = createContext<AppNavigation | null>(null)

export const useAppNav = () => {
  const context = useContext(AppNavContext)
  if (!context) {
    throw new Error('useAppNav must be used within an AppNavProvider')
  }
  return context
}
