import React, { createContext, useContext, useEffect, useState } from 'react'
import { Platform } from 'react-native'

export type NetworkStatus = 'online' | 'offline' | 'degraded' | 'reconnecting'

type NetworkContextValue = {
  isOnline: boolean
  isDegraded: boolean
  status: NetworkStatus
  reportDegraded: (degraded: boolean) => void
  retry: () => void
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  isDegraded: false,
  status: 'online',
  reportDegraded: () => {},
  retry: () => {},
})

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [isDegraded, setIsDegraded] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Initial check
    setIsOnline(window.navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const status: NetworkStatus = !isOnline 
    ? 'offline' 
    : isDegraded 
      ? 'degraded' 
      : 'online'

  const value: NetworkContextValue = {
    isOnline,
    isDegraded,
    status,
    reportDegraded: (val) => setIsDegraded(val),
    retry: () => setRetryTrigger(prev => prev + 1),
  }

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetworkState() {
  return useContext(NetworkContext)
}
