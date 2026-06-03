import React from 'react'
import { ListSessionCard } from '@/components/sessions/v2/SessionCards'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { Session } from '../types'

type SearchResultCardProps = {
  session: Session
  userLocation: any // Ignored for now to match Host Dashboard style
}

export function SearchResultCard({ session }: SearchResultCardProps) {
  const { onOpenSession } = useSessionNav()
  
  return (
    <ListSessionCard
      session={session}
      isHost={false}
      onPress={() => onOpenSession(session.id)}
    />
  )
}
