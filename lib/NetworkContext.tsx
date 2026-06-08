import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    if (Platform.OS !== 'web') return

    const handleOnline = () => {
      setIsOnline(true)
      setIsDegraded(false)
    }
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

  const reportDegraded = useCallback((val: boolean) => {
    setIsDegraded(val)
  }, [])

  const retry = useCallback(() => {
    if (Platform.OS === 'web') {
      const online = window.navigator.onLine
      setIsOnline(online)
      if (online) setIsDegraded(false)
      return
    }
    setIsDegraded(false)
  }, [])

  const value: NetworkContextValue = useMemo(() => ({
    isOnline,
    isDegraded,
    status,
    reportDegraded,
    retry,
  }), [isDegraded, isOnline, reportDegraded, retry, status])

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetworkState() {
  return useContext(NetworkContext)
}
