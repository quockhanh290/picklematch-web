import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import React from 'react'
import { Text, View } from 'react-native'

type Props = {
  activePlayerCount: number
  liveMatchCount: number
  pendingMatchCount: number
  pendingRoundCount: number
  courtCount: number
}

export function MatchControlHeader({
  activePlayerCount,
  liveMatchCount,
  pendingMatchCount,
  pendingRoundCount,
  courtCount,
}: Props) {
  return (
    <View style={{ backgroundColor: '#1A2E2A', borderRadius: RADIUS.xl, padding: 16, marginBottom: 16 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: 'white', fontWeight: '900' }}>
        QUAN LY TRAN
      </Text>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#DDEBE4', marginTop: 4 }}>
        Dieu phoi live match, lich cho va nguoi choi trong cung mot man.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {[
          { label: 'Nguoi choi', value: activePlayerCount },
          { label: 'San', value: courtCount },
          { label: 'Live', value: liveMatchCount },
          { label: 'Tran cho', value: pendingMatchCount },
          { label: 'Vong cho', value: pendingRoundCount },
        ].map(item => (
          <View key={item.label} style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 8, minWidth: 78 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: 'white', fontWeight: '900' }}>{item.value}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#B7D8CA', marginTop: 1 }}>{item.label}</Text>
          </View>
        ))}
      </View>

    </View>
  )
}
