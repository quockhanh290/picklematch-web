import React from 'react'
import type { MatchSession } from '@/lib/homeFeed'
import { PlayerHeroMatchSessionCard } from './match-card/player/PlayerHeroMatchSessionCard'
import { PlayerSuggestedSessionCard } from './match-card/player/PlayerSuggestedSessionCard'
import { OwnerSuggestedSessionCard } from './match-card/owner/OwnerSuggestedSessionCard'
import { PlayerUrgentFillCard } from './match-card/player/PlayerUrgentFillCard'
import { PlayerSessionListCard } from './match-card/player/PlayerSessionListCard'

export const SMART_MATCH_CARD_HEIGHT = 380

export function MatchSessionCard({
  item,
  variant,
  actionLabel,
  accentMode = 'default',
  showFullAddress,
  isOwnerDetail,
  isPreview,
  fullCourtName,
  showPlayerList,
  onTogglePlayerList,
  footer,
}: {
  item: MatchSession
  variant: 'hero' | 'smart' | 'standard'
  actionLabel: string
  accentMode?: 'default' | 'rescue'
  showFullAddress?: boolean
  isOwnerDetail?: boolean
  isPreview?: boolean
  fullCourtName?: boolean
  showPlayerList?: boolean
  onTogglePlayerList?: () => void
  footer?: React.ReactNode
}) {
  if (variant === 'hero') {
    return <PlayerHeroMatchSessionCard item={item} actionLabel={actionLabel} />
  }

  if (accentMode === 'default') {
    if (isOwnerDetail) {
      return (
        <OwnerSuggestedSessionCard 
          item={item} 
          isPreview={isPreview} 
          fullCourtName={fullCourtName}
          showPlayerList={showPlayerList}
          onTogglePlayerList={onTogglePlayerList}
          footer={footer}
        />
      )
    }
    return (
      <PlayerSuggestedSessionCard 
        item={item} 
        fullCourtName={fullCourtName}
      />
    )
  }

  if (accentMode === 'rescue') {
    return <PlayerUrgentFillCard item={item} />
  }

  return <PlayerSessionListCard item={item} actionLabel={actionLabel} accentMode={accentMode} />
}
