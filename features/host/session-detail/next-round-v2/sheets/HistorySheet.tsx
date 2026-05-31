import React from 'react'
import { Text, View } from 'react-native'

import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { SessionRoundRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { Card, SheetTitle } from '../components'
import { ctaTextStyle, playerName } from '../helpers'

export function HistorySheet({ rounds, playersById }: { rounds: SessionRoundRow[]; playersById: Map<string, ArrangementPlayer> }) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Lịch sử vòng" subtitle="Các vòng đã lưu trong live session." />
      <View style={{ gap: 10 }}>
        {rounds.map(round => (
          <Card key={round.round_no} style={{ borderRadius: RADIUS.md, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Vòng {round.round_no}</Text>
              <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.successBg, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={ctaTextStyle(theme.successText, 11)}>Đã lưu</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              {round.matches.map(match => (
                <View key={`${round.round_no}-${match.court_idx}`} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surfaceAlt, padding: 8 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
                    {match.team_a.map(id => playerName(id, playersById)).join(' · ')} vs {match.team_b.map(id => playerName(id, playersById)).join(' · ')}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.rescueAccent }}>
              Nghỉ: {round.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  )
}
