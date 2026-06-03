import React from 'react'
import { View, ScrollView, Text, SafeAreaView } from 'react-native'
import { FeaturedSessionCard, ListSessionCard, MockSession } from '@/components/sessions/v2/UniversalSessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { WebContainer } from '@/components/design/WebContainer'

export default function TestCardsScreen() {
  const theme = useAppTheme()

  const mockDate = new Date()
  mockDate.setHours(18, 0, 0, 0)
  const mockEnd = new Date()
  mockEnd.setHours(20, 0, 0, 0)

  const baseSession: MockSession = {
    id: '1',
    title: 'GIAO LƯU SOCIAL',
    courtName: 'SÂN PICKLEBALL AN PHÚ',
    courtAddress: '123 Mai Chí Thọ, Quận 2',
    startTime: mockDate.toISOString(),
    endTime: mockEnd.toISOString(),
    confirmedCount: 12,
    maxPlayers: 16,
    price: 50,
    status: 'open',
    formatLabel: 'OPEN PLAY',
    skillNam: '2.5 - 3.0',
    skillNu: '2.0 - 2.5'
  }

  const states = [
    { label: 'Trạng thái: ĐANG MỞ (Open)', session: { ...baseSession, status: 'open' as const } },
    { label: 'Trạng thái: THI ĐẤU (Playing)', session: { ...baseSession, status: 'playing' as const, confirmedCount: 16 } },
    { label: 'Trạng thái: ĐÃ ĐẦY (Full)', session: { ...baseSession, status: 'full' as const, confirmedCount: 16 } },
    { label: 'Trạng thái: CẦN THÊM NGƯỜI (Urgent)', session: { ...baseSession, status: 'urgent' as const, confirmedCount: 8 } },
    { label: 'Trạng thái: KẾT THÚC (Done)', session: { ...baseSession, status: 'done' as const, confirmedCount: 15 } },
  ]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <WebContainer>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, marginBottom: 20, color: theme.onSurface }}>
            UI UNIFICATION TEST
          </Text>

          <View style={{ marginBottom: 40 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, marginBottom: 16, color: theme.primary, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant, paddingBottom: 8 }}>
              GÓC NHÌN HOST (Tất cả trạng thái)
            </Text>
            {states.map((s, idx) => (
              <View key={`host-${idx}`} style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, marginBottom: 8, color: theme.onSurfaceVariant }}>{s.label}</Text>
                {/* Dùng Featured cho Kèo Đầu Tiên, List cho các kèo còn lại để dễ nhìn */}
                {idx === 0 
                  ? <FeaturedSessionCard session={s.session} isHost={true} />
                  : <ListSessionCard session={s.session} isHost={true} />
                }
              </View>
            ))}
          </View>

          <View style={{ marginBottom: 40 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, marginBottom: 16, color: theme.primary, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant, paddingBottom: 8 }}>
              GÓC NHÌN PLAYER
            </Text>
            {states.map((s, idx) => (
              <View key={`player-${idx}`} style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, marginBottom: 8, color: theme.onSurfaceVariant }}>{s.label}</Text>
                {/* Player cũng có thẻ To (Featured) cho Kèo sắp tới của cá nhân */}
                {idx === 0 
                  ? <FeaturedSessionCard session={{...s.session, formatLabel: 'SẮP TỚI'}} isHost={false} />
                  : <ListSessionCard session={s.session} isHost={false} />
                }
              </View>
            ))}
          </View>

        </WebContainer>
      </ScrollView>
    </SafeAreaView>
  )
}
