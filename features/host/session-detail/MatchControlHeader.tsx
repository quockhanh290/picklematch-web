import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import React from 'react'
import { Text, View, useWindowDimensions } from 'react-native'

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
  const { width: screenWidth } = useWindowDimensions()
  const stats = [
    { label: 'Người chơi', value: activePlayerCount, tone: 'warm' },
    { label: 'Sân đấu', value: courtCount, tone: 'neutral' },
    { label: 'Đang live', value: liveMatchCount, tone: liveMatchCount > 0 ? 'live' : 'neutral' },
    { label: 'Trận chờ', value: pendingMatchCount, tone: pendingMatchCount > 0 ? 'warn' : 'neutral' },
    { label: 'Vòng chờ', value: pendingRoundCount, tone: pendingRoundCount > 0 ? 'warn' : 'neutral' },
  ]
  const isCompact = screenWidth < 420
  const statBoxWidth = isCompact ? '31.5%' : '18.8%'

  return (
    <View style={{ backgroundColor: '#143B35', borderRadius: RADIUS.xl, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#D8D3C8' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: 'white', fontWeight: '900' }}>
            QUẢN LÝ TRẬN ĐẤU
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#E8E2D6', marginTop: 4, lineHeight: 16 }}>
            Theo dõi trận live, lịch chờ và người chơi sẵn sàng.
          </Text>
        </View>

        <View style={{ backgroundColor: liveMatchCount > 0 ? '#FFF5DE' : 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: liveMatchCount > 0 ? '#E7C66A' : 'rgba(255,255,255,0.14)' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: liveMatchCount > 0 ? '#854F0B' : '#D8D3C8', fontWeight: '900' }}>
            {liveMatchCount > 0 ? 'ĐANG LIVE' : 'CHƯA LIVE'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', rowGap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {stats.map(item => {
          const isWarm = item.tone === 'warm'
          const isWarn = item.tone === 'warn'
          const isLive = item.tone === 'live'
          const backgroundColor = isWarm
            ? '#FFF5DE'
            : isWarn
              ? '#FAEEDA'
              : isLive
                ? '#E1F5EE'
                : 'rgba(255,255,255,0.07)'
          const borderColor = isWarm || isWarn
            ? '#E7C66A'
            : isLive
              ? '#B7E4D5'
              : 'rgba(255,255,255,0.10)'
          const textColor = isWarm || isWarn
            ? '#854F0B'
            : isLive
              ? '#0F6E56'
              : 'white'
          const labelColor = isWarm || isWarn
            ? '#854F0B'
            : isLive
              ? '#0F6E56'
              : '#D8D3C8'

          return (
            <View
              key={item.label}
              style={{
                backgroundColor,
                borderRadius: RADIUS.md,
                paddingHorizontal: 10,
                paddingVertical: 10,
                width: statBoxWidth,
                minHeight: 66,
                borderWidth: 1,
                borderColor,
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: textColor, fontWeight: '900', textAlign: 'center' }}>
                {item.value}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: labelColor, marginTop: 3, fontWeight: '700', textAlign: 'center', lineHeight: 12 }} numberOfLines={2}>
                {item.label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
