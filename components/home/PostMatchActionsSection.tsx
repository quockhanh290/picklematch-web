import { router } from 'expo-router'
import { AlertTriangle, CheckCheck, Clock } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'

import type { PostMatchAction } from '@/lib/homeFeed'

export function PostMatchActionsSection({ items }: { items: PostMatchAction[] }) {
  const theme = useAppTheme()
  if (items.length === 0) return null

  return (
    <View
      className="mt-6 rounded-[24px] border p-5"
      style={{ borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest }}
    >
      <Text className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: theme.outline }}>Sau trận</Text>
      <Text className="mt-2 text-[24px] font-black" style={{ color: theme.onSurface }}>Việc bạn cần xử lý</Text>

      <View className="mt-4 gap-3">
        {items.map((item) => {
          const isConfirm = item.actionType === 'confirm'
          const tone = isConfirm
            ? {
                icon: theme.primary,
                cardBg: theme.tertiaryFixed,
                cardBorder: theme.secondaryFixedDim,
                title: theme.onTertiaryFixedVariant,
                button: theme.primary,
              }
            : {
                icon: theme.error,
                cardBg: theme.primaryFixed,
                cardBorder: theme.secondaryFixedDim,
                title: theme.onPrimaryFixedVariant,
                button: theme.primary,
              }

          return (
            <View
              key={`${item.actionType}-${item.id}`}
              className="rounded-[24px] border p-4"
              style={{ borderColor: tone.cardBorder, backgroundColor: tone.cardBg }}
            >
              <View className="flex-row items-start">
                <View
                  className="mt-1 h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: theme.surfaceContainerLowest }}
                >
                  {isConfirm ? (
                    <CheckCheck size={18} color={tone.icon} strokeWidth={2.5} />
                  ) : (
                    <AlertTriangle size={18} color={tone.icon} strokeWidth={2.5} />
                  )}
                </View>

                <View className="ml-3 flex-1">
                  <Text className="text-[15px] font-black" style={{ color: tone.title }}>
                    {isConfirm ? 'Xác nhận kết quả chủ kèo đã gửi' : 'Chủ kèo chưa gửi kết quả, bạn có thể báo trận'}
                  </Text>
                  <Text className="mt-2 text-[15px] font-bold" style={{ color: theme.onSurface }}>{item.courtName}</Text>
                  <View className="mt-2 flex-row items-center">
                    <Clock size={14} color={theme.outline} strokeWidth={2.5} />
                    <Text className="ml-2 text-sm font-semibold" style={{ color: theme.onSurfaceVariant }}>{item.timeLabel}</Text>
                  </View>
                </View>
              </View>

              <Pressable
                onPress={() => router.push({ pathname: '/session/[id]/confirm-result' as never, params: { id: item.id } })}
                className="mt-4 h-12 items-center justify-center rounded-full"
                style={{ backgroundColor: tone.button }}
              >
                <Text className="text-[13px] font-black uppercase tracking-[0.08em]" style={{ color: theme.onPrimary }}>
                  {isConfirm ? 'Mở xác nhận' : 'Báo kết quả'}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </View>
    </View>
  )
}




