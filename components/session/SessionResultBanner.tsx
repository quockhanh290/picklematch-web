import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
            ? t('session_result.disputed_title')
            : resultsStatus === 'pending_confirmation'
              ? t('session_result.pending_title')
              : t('session_result.no_result_title')}
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
            ? t('session_result.disputed_desc_host')
            : t('session_result.disputed_desc_player')
          : resultsStatus === 'pending_confirmation'
            ? t('session_result.pending_desc')
            : t('session_result.no_result_desc')}
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
              ? t('session_result.btn_update_result')
              : t('session_result.btn_confirm_result')
            : resultsStatus === 'pending_confirmation'
              ? t('session_result.btn_confirm_result')
              : t('session_result.btn_report_result')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
