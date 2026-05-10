import React from 'react'
import { Text, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'

export type SessionTab = 'upcoming' | 'pending' | 'history'

export function MySessionsEmptyState({ activeTab }: { activeTab: SessionTab }) {
  const theme = useAppTheme()
  const config =
    activeTab === 'upcoming'
      ? {
          eyebrow: 'SẴN SÀNG RA SÂN',
          title: 'Bạn chưa có kèo sắp đánh',
          description: 'Tạo kèo mới hoặc tham gia một trận phù hợp để lịch chơi của bạn bắt đầu đầy lên.',
        }
      : activeTab === 'pending'
        ? {
            eyebrow: 'ĐANG CHỜ',
            title: 'Chưa có yêu cầu nào cần duyệt',
            description: 'Những kèo bạn đang chờ chủ kèo phản hồi sẽ xuất hiện tại đây.',
          }
        : {
            eyebrow: 'LỊCH SỬ THI ĐẤU',
            title: 'Bạn chưa có lịch sử trận đấu',
            description: 'Sau khi hoàn thành các trận đã chơi, phần lịch sử sẽ hiển thị tại đây.',
          }

  return (
    <View
      style={{
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        ...SHADOW.xs,
        marginTop: 12
      }}
    >
      <View style={{ padding: 28, backgroundColor: '#FCFAF7' }}>
        <Text
          style={{
            color: theme.primary,
            fontFamily: SCREEN_FONTS.cta,
            fontSize: 10,
            letterSpacing: 2.2,
            textTransform: 'uppercase',
            marginBottom: 16
          }}
        >
          {config.eyebrow}
        </Text>
        <Text
          style={{
            color: theme.onSurface,
            fontFamily: SCREEN_FONTS.headline,
            fontSize: 26,
            lineHeight: 32,
            textTransform: 'uppercase',
            marginBottom: 10
          }}
        >
          {config.title}
        </Text>
        <Text
          style={{
            color: theme.onSurfaceVariant,
            fontFamily: SCREEN_FONTS.body,
            fontSize: 15,
            lineHeight: 24,
            maxWidth: '90%'
          }}
        >
          {config.description}
        </Text>
      </View>
    </View>
  )
}

