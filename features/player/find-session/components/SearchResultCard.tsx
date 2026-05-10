import React from 'react'
import { PlayerSessionCard } from './PlayerSessionCard'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { Session } from '../types'

type SearchResultCardProps = {
  session: Session
  userLocation: any // Ignored for now to match Host Dashboard style
}

export function SearchResultCard({ session }: SearchResultCardProps) {
  const { onOpenSession } = useSessionNav()
  
  return (
    <PlayerSessionCard
      session={session}
      onPress={() => onOpenSession(session.id)}
    />
  )
}
