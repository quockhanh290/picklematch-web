import { Check, ChevronRight, MessageSquareText, ShieldAlert, X } from 'lucide-react-native'
import { Text, TouchableOpacity, View } from 'react-native'

import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'

type RequestItem = {
  id: string
  player_id: string
  intro_note?: string | null
  host_response_template?: string | null
  player: {
    name: string
    elo?: number | null
    current_elo?: number | null
    sessions_joined?: number | null
    no_show_count?: number | null
  }
}

const TEMPLATES = [
  'Trình hơi lệch, bạn chắc chứ?',
  'Đợi mình gom đủ người rồi báo nhé',
  'Ưu tiên nữ để cân team',
]

type Props = {
  requests: RequestItem[]
  matchTargetElo: number
  onOpenPlayer: (playerId: string) => void
  onAccept: (requestId: string, playerId: string) => void
  onReject: (requestId: string, playerId: string) => void
  onReplyTemplate: (requestId: string, playerId: string, template: string) => void
}

export function HostRequestReview({
  requests,
  matchTargetElo,
  onOpenPlayer,
  onAccept,
  onReject,
  onReplyTemplate,
}: Props) {
  const theme = useAppTheme()
  if (requests.length === 0) return null

  return (
    <View className="mt-8">
      <Text className="mb-1 text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: theme.outline }}>
        Duyệt yêu cầu
      </Text>
      <Text
        style={{
          marginBottom: 16,
          fontSize: 24,
          fontFamily: SCREEN_FONTS.headline,
          color: theme.onSurface,
          textTransform: 'uppercase',
        }}
      >
        Yêu cầu tham gia
      </Text>

      {requests.map((request) => {
        const playerElo = request.player.current_elo ?? request.player.elo ?? 0
        const diff = playerElo - matchTargetElo
        const diffLabel = `${diff >= 0 ? '+' : ''}${diff} Elo`
        const diffTone =
          diff >= 0
            ? {
                bg: theme.primaryFixed,
                text: theme.onPrimaryFixedVariant,
              }
            : {
                bg: theme.errorContainer,
                text: theme.onErrorContainer,
              }

        return (
          <View
            key={request.id}
            className="mb-4 rounded-[24px] border p-4"
            style={{
              borderColor: theme.outlineVariant,
              backgroundColor: theme.surfaceContainerLowest,
              shadowColor: theme.onBackground,
              shadowOpacity: 0.05,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
              elevation: 2,
            }}
          >
            <TouchableOpacity activeOpacity={0.88} onPress={() => onOpenPlayer(request.player_id)}>
              <View className="flex-row items-start justify-between">
                <View className="mr-4 flex-1">
                  <Text className="text-[11px] font-extrabold uppercase tracking-[1px]" style={{ color: theme.outline }}>
                    Người chơi
                  </Text>
                  <Text
                    style={{
                      marginTop: 8,
                      fontSize: 18,
                      fontFamily: SCREEN_FONTS.headline,
                      color: theme.onSurface,
                      textTransform: 'uppercase',
                    }}
                  >
                    {request.player.name}
                  </Text>
                  <Text className="mt-1 text-sm" style={{ color: theme.onSurfaceVariant }}>
                    Elo {playerElo} • {request.player.sessions_joined ?? 0} kèo • {request.player.no_show_count ?? 0} no-show
                  </Text>
                </View>

                <View className="rounded-full px-3 py-2" style={{ backgroundColor: diffTone.bg }}>
                  <Text className="text-xs font-bold" style={{ color: diffTone.text }}>
                    {diffLabel}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View className="mt-4 rounded-2xl px-4 py-4" style={{ backgroundColor: theme.surfaceContainerLow }}>
              <View className="flex-row items-center">
                <MessageSquareText size={15} color={theme.outline} />
                <Text className="ml-2 text-[11px] font-extrabold uppercase tracking-[1px]" style={{ color: theme.outline }}>
                  Lời nhắn giới thiệu
                </Text>
              </View>
              <Text className="mt-2 text-sm leading-6" style={{ color: theme.onSurface }}>
                {request.intro_note?.trim() ? request.intro_note : 'Người chơi chưa để lại lời nhắn.'}
              </Text>
            </View>

            {request.host_response_template ? (
              <View
                className="mt-3 rounded-2xl border px-4 py-4"
                style={{
                  borderColor: theme.secondaryFixedDim,
                  backgroundColor: theme.tertiaryFixed,
                }}
              >
                <View className="flex-row items-center">
                  <ShieldAlert size={15} color={theme.onTertiaryFixedVariant} />
                  <Text className="ml-2 text-[11px] font-extrabold uppercase tracking-[1px]" style={{ color: theme.onTertiaryFixedVariant }}>
                    Phản hồi đã gửi
                  </Text>
                </View>
                <Text className="mt-2 text-sm leading-6" style={{ color: theme.onTertiaryFixedVariant }}>
                  {request.host_response_template}
                </Text>
              </View>
            ) : null}

            <View className="mt-4 flex-row gap-3">
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => onAccept(request.id, request.player_id)}
                className="flex-1 flex-row items-center justify-center rounded-2xl py-3.5"
                style={{ backgroundColor: theme.primary }}
              >
                <Check size={16} color={theme.onPrimary} />
                <Text className="ml-2 text-sm font-bold" style={{ color: theme.onPrimary }}>
                  Nhận vào
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => onReject(request.id, request.player_id)}
                className="flex-1 flex-row items-center justify-center rounded-2xl py-3.5"
                style={{ backgroundColor: theme.errorContainer }}
              >
                <X size={16} color={theme.dangerText} />
                <Text className="ml-2 text-sm font-bold" style={{ color: theme.dangerText }}>
                  Từ chối
                </Text>
              </TouchableOpacity>
            </View>

            <View className="mt-4 flex-row flex-wrap gap-2">
              {TEMPLATES.map((template) => (
                <TouchableOpacity
                  key={template}
                  activeOpacity={0.9}
                  onPress={() => onReplyTemplate(request.id, request.player_id, template)}
                  className="flex-row items-center rounded-full border px-3 py-2"
                  style={{
                    borderColor: theme.outlineVariant,
                    backgroundColor: theme.surfaceContainerLow,
                  }}
                >
                  <Text className="text-xs font-semibold" style={{ color: theme.onSurface }}>
                    {template}
                  </Text>
                  <ChevronRight size={12} color={theme.onSurfaceVariant} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}

