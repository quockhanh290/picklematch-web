import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { CheckCheck, ShieldAlert } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'

interface SessionResultBannerProps {
  id: string
  resultsStatus?: string | null
  isHost: boolean
  isResultDisputed: boolean
  canRespondToResult: boolean
}

export const SessionResultBanner: React.FC<SessionResultBannerProps> = ({
  id,
  resultsStatus,
  isHost,
  isResultDisputed,
  canRespondToResult,
}) => {
  const theme = useAppTheme()
  const { onViewMatchResult, onConfirmResult } = useSessionNav()
  if (!canRespondToResult && !(isHost && isResultDisputed)) return null

  const resultBannerTone = isResultDisputed
    ? {
        border: theme.dangerBorderSoft,
        background: theme.dangerBg,
        text: theme.dangerText,
        button: theme.dangerStrong,
      }
    : {
        border: theme.secondaryFixedDim,
        background: theme.tertiaryFixed,
        text: theme.onTertiaryFixedVariant,
        button: theme.primaryContainer,
      }

  return (
    <View
      style={{
        marginTop: 20,
        borderRadius: RADIUS.lg,
        borderWidth: BORDER.base,
        padding: SPACING.xl,
        borderColor: resultBannerTone.border,
        backgroundColor: resultBannerTone.background,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {resultsStatus === 'disputed' ? (
          <ShieldAlert size={18} color={theme.dangerText} strokeWidth={2.5} />
        ) : (
          <CheckCheck size={18} color={theme.onSecondaryFixedVariant} strokeWidth={2.5} />
        )}
        <Text
          style={{
            marginLeft: 8,
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: resultBannerTone.text,
          }}
        >
          {resultsStatus === 'disputed'
            ? 'Kết quả đang bị tranh chấp'
            : resultsStatus === 'pending_confirmation'
              ? 'Chủ kèo đã gửi kết quả trận'
              : 'Chủ kèo chưa gửi kết quả'}
        </Text>
      </View>

      <Text
        style={{
          marginTop: 12,
          fontSize: 14,
          lineHeight: 22,
          fontFamily: SCREEN_FONTS.body,
          color: resultBannerTone.text,
        }}
      >
        {resultsStatus === 'disputed'
          ? isHost
            ? 'Người chơi đã khiếu nại kết quả này. Vui lòng kiểm tra và cập nhật lại thông tin chính xác.'
            : 'Vào màn xác nhận để xem lại kết quả chủ kèo đã gửi và cập nhật phản hồi của bạn.'
          : resultsStatus === 'pending_confirmation'
            ? 'Bạn cần xác nhận hoặc tranh chấp kết quả trước khi hệ thống chốt trận.'
            : 'Nếu chủ kèo chưa gửi kết quả đúng hạn, bạn có thể báo kết quả của mình để hệ thống xử lý tiếp.'}
      </Text>

      <TouchableOpacity
        className="mt-4 h-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: resultBannerTone.button }}
        onPress={() => {
          if (isHost && isResultDisputed) {
            onViewMatchResult(id)
          } else {
            onConfirmResult(id)
          }
        }}
        activeOpacity={0.9}
      >
        <Text
          style={{
            fontSize: 14,
            fontFamily: SCREEN_FONTS.headline,
            textTransform: 'uppercase',
            letterSpacing: 1.1,
            color: theme.onPrimary,
          }}
        >
          {resultsStatus === 'disputed'
            ? isHost
              ? 'Cập nhật lại kết quả'
              : 'Xác nhận kết quả'
            : resultsStatus === 'pending_confirmation'
              ? 'Xác nhận kết quả'
              : 'Báo kết quả'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
