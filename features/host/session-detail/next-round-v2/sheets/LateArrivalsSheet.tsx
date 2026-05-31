import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'

import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { Card, PlayerAvatar, SheetTitle } from '../components'
import { ctaTextStyle, getPlayerPvna } from '../helpers'

export function LateArrivalsSheet({
  players,
  busy,
  onAddPlayer,
}: {
  players: ArrangementPlayer[]
  busy: string | null
  onAddPlayer: (playerId: string) => void
}) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Người đến muộn" subtitle="Thêm người đã tới muộn vào roster live để engine xếp từ vòng kế tiếp." />
      <View style={{ gap: 8 }}>
        {players.length === 0 ? (
          <Card style={{ padding: 14, backgroundColor: theme.surfaceContainerLow }}>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>
              Không còn ai trong danh sách chưa tới.
            </Text>
          </Card>
        ) : players.map(player => {
          const playerId = String(player.id)
          const loading = busy === `late-${playerId}`
          return (
            <Card key={`late-${playerId}`} style={{ borderRadius: RADIUS.md, padding: 10 }}>
              <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <PlayerAvatar name={player.name || 'Người chơi'} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }} numberOfLines={1}>
                    {player.name || 'Người chơi'}
                  </Text>
                  <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    PVNA {(getPlayerPvna(player) ?? 0).toFixed(2)} · trạng thái chưa tới
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onAddPlayer(playerId)}
                  disabled={loading}
                  style={{
                    minHeight: 40,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.secondaryContainer,
                    paddingHorizontal: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {loading ? <ActivityIndicator color={theme.primary} /> : <Text style={ctaTextStyle(theme.primary, 11)}>Thêm</Text>}
                </TouchableOpacity>
              </View>
            </Card>
          )
        })}
      </View>
    </View>
  )
}
