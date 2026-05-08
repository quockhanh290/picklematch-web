import React from 'react'
import { View, Text, Pressable } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { PlayerQueueProfile } from '../types'

type SmartQueueBannerProps = {
  smartQueueEnabled: boolean
  smartQueueHydrated: boolean
  playerProfile: PlayerQueueProfile | null
  onToggle: (enabled: boolean) => void
  filteredSessionsCount: number
  loading: boolean
}

export function SmartQueueBanner({
  smartQueueEnabled,
  smartQueueHydrated,
  playerProfile,
  onToggle,
  filteredSessionsCount,
  loading,
}: SmartQueueBannerProps) {
  const theme = useAppTheme()
  return (
    <View className="px-5 pb-10">
      {!loading && filteredSessionsCount === 0 ? (
        <View
          className="mb-4 rounded-[24px] px-6 py-7"
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
          <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.headline, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>
            {STRINGS.find_session.empty.no_results}
          </Text>
          <Text className="mt-3" style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, fontSize: 22, lineHeight: 28, textTransform: 'uppercase', letterSpacing: 1 }}>
            {STRINGS.find_session.empty.no_results_sub}
          </Text>
          <Text className="mt-2" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14, lineHeight: 22 }}>
            Hệ thống sẽ tiếp tục săn trận phù hợp để bạn không bỏ lỡ cơ hội vào sân đúng gu.
          </Text>
        </View>
      ) : null}

      <View
        className="rounded-[24px] px-6 py-6"
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
        <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.headline, fontSize: 10, letterSpacing: 2.2, textTransform: 'uppercase' }}>
          Gợi ý thông minh
        </Text>
        <Text className="mt-3" style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, fontSize: 22, lineHeight: 28, textTransform: 'uppercase', letterSpacing: 1 }}>
          Chưa thấy kèo ưng ý?
        </Text>
        <Text className="mt-2" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14, lineHeight: 22 }}>
          Bật gợi ý hợp gu để ưu tiên kèo vừa trình, vừa giờ, vừa khoảng cách bạn đang săn.
        </Text>

        {smartQueueEnabled ? (
          <Text
            className="mt-3"
            style={{ color: theme.primary, fontFamily: SCREEN_FONTS.label, fontSize: 12, lineHeight: 18 }}
          >
            Đang ưu tiên kèo gần {playerProfile?.city?.trim() || 'gu của bạn'} và khớp nhịp chơi hiện tại
          </Text>
        ) : null}

        <Pressable
          onPress={() => onToggle(!smartQueueEnabled)}
          disabled={!smartQueueHydrated}
          className="mt-4 flex-row items-center justify-center rounded-[20px] px-4 py-3.5"
          style={{
            backgroundColor: smartQueueEnabled
              ? theme.surfaceContainerHighest
              : theme.primary,
            opacity: !smartQueueHydrated ? 0.5 : 1,
          }}
        >
          <Sparkles
            size={15}
            color={smartQueueEnabled ? theme.onSurfaceVariant : theme.onPrimary}
            strokeWidth={2.3}
          />
          <Text
            className="ml-2 text-[13px]"
            style={{
              color: smartQueueEnabled ? theme.onSurfaceVariant : theme.onPrimary,
              fontFamily: SCREEN_FONTS.label,
            }}
          >
            {smartQueueEnabled ? 'Tắt gợi ý hợp gu' : 'Bật gợi ý hợp gu'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
