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
      className="rounded-[24px] px-6 py-7"
      style={{
        backgroundColor: theme.surfaceContainerLowest,
        borderLeftWidth: 3,
        borderLeftColor: theme.primary,
        shadowColor: theme.onBackground,
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      <Text
        style={{
          color: theme.outline,
          fontFamily: SCREEN_FONTS.cta,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        {config.eyebrow}
      </Text>
      <Text
        className="mt-3"
        style={{
          color: theme.onBackground,
          fontFamily: SCREEN_FONTS.headline,
          fontSize: 22,
          lineHeight: 28,
        }}
      >
        {config.title}
      </Text>
      <Text
        className="mt-2"
        style={{
          color: theme.onSurfaceVariant,
          fontFamily: SCREEN_FONTS.body,
          fontSize: 14,
          lineHeight: 22,
        }}
      >
        {config.description}
      </Text>
    </View>
  )
}

