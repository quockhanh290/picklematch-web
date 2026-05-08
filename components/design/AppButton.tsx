import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'

import { AppFontSet } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, BUTTON } from '@/constants/screenLayout'

type Props = {
  label: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  fullWidth?: boolean
  textColor?: string
  style?: any
}

export function AppButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  fullWidth = true,
  textColor,
  style,
}: Props) {
  const theme = useAppTheme()
  const isPrimary = variant === 'primary'
  const isSecondary = variant === 'secondary'
  const isDanger = variant === 'danger'

  const baseStyle = (isPrimary || isDanger)
    ? BUTTON.primary
    : isSecondary
      ? BUTTON.secondary
      : { borderRadius: RADIUS.md, paddingVertical: 13, paddingHorizontal: SPACING.xl }

  const buttonStyle = {
    ...baseStyle,
    backgroundColor: isPrimary ? theme.primary : isDanger ? theme.error : 'transparent',
    borderColor: isDanger ? theme.error : theme.primary,
  }

  const defaultTextColor = isPrimary
    ? theme.onPrimary
    : isDanger
      ? theme.onError
      : isSecondary
        ? theme.primary
        : theme.onSurfaceVariant

  const resolvedTextColor = textColor ?? defaultTextColor

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        buttonStyle,
        fullWidth && { width: '100%' },
        (disabled || loading) && { opacity: 0.7 },
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      {loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={resolvedTextColor} />
          <Text style={{ color: resolvedTextColor, fontFamily: AppFontSet.cta, fontSize: 16, textTransform: 'uppercase', textAlign: 'center' }}>
            Đang xử lý...
          </Text>
        </View>
      ) : (
        <Text style={{ color: resolvedTextColor, fontFamily: AppFontSet.cta, fontSize: 16, textTransform: 'uppercase', textAlign: 'center' }}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  )
}
