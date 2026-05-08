import type { TextStyle, ViewStyle } from 'react-native'

import type { AppTheme } from '@/constants/theme'

export const appRadii = {
  sm: 'rounded-2xl',
  md: 'rounded-[24px]',
  lg: 'rounded-[24px]',
} as const

export const appRadiusValues = {
  sm: 18,
  md: 28,
  lg: 32,
} as const

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

type TonePalette = {
  backgroundColor: string
  textColor: string
  borderColor: string
  activeBackgroundColor: string
  activeTextColor: string
}

export function getTonePalette(theme: AppTheme, tone: BadgeTone): TonePalette {
  switch (tone) {
    case 'success':
      return {
        backgroundColor: theme.primarySoft,
        textColor: theme.primaryStrong,
        borderColor: theme.primary,
        activeBackgroundColor: theme.primary,
        activeTextColor: theme.primaryContrast,
      }
    case 'warning':
      return {
        backgroundColor: theme.warningSoft,
        textColor: theme.warning,
        borderColor: theme.warning,
        activeBackgroundColor: theme.warning,
        activeTextColor: theme.text,
      }
    case 'danger':
      return {
        backgroundColor: theme.dangerSoft,
        textColor: theme.danger,
        borderColor: theme.danger,
        activeBackgroundColor: theme.danger,
        activeTextColor: theme.primaryContrast,
      }
    case 'info':
      return {
        backgroundColor: theme.infoSoft,
        textColor: theme.info,
        borderColor: theme.info,
        activeBackgroundColor: theme.info,
        activeTextColor: theme.primaryContrast,
      }
    case 'neutral':
    default:
      return {
        backgroundColor: theme.surfaceAlt,
        textColor: theme.textMuted,
        borderColor: theme.borderStrong,
        activeBackgroundColor: theme.text,
        activeTextColor: theme.primaryContrast,
      }
  }
}

export function getSurfaceStyle(
  theme: AppTheme,
  tone: 'default' | 'muted' | 'alt' = 'default'
): ViewStyle {
  if (tone === 'muted') {
    return {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
    }
  }

  if (tone === 'alt') {
    return {
      backgroundColor: theme.surfaceAlt,
      borderColor: theme.border,
    }
  }

  return {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  }
}

export function getShadowStyle(theme: AppTheme, level: 'card' | 'raised' = 'card'): ViewStyle {
  if (level === 'raised') {
    return {
      shadowColor: theme.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 14 },
      elevation: 8,
    }
  }

  return {
    shadowColor: theme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  }
}

export function getTextToneStyle(theme: AppTheme, tone: 'default' | 'muted' | 'soft' = 'default'): TextStyle {
  if (tone === 'muted') {
    return { color: theme.textMuted }
  }

  if (tone === 'soft') {
    return { color: theme.textSoft }
  }

  return { color: theme.text }
}
