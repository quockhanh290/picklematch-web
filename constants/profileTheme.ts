export type ProfileThemeColors = {
  surfaceContainerHigh: string
  surfaceContainerLow: string
  inverseOnSurface: string
  secondaryFixed: string
  onSecondaryFixedVariant: string
  surfaceBright: string
  tertiary: string
  secondary: string
  onSecondaryFixed: string
  primaryContainer: string
  onError: string
  primaryFixed: string
  onPrimaryFixed: string
  tertiaryFixedDim: string
  background: string
  primaryFixedDim: string
  onBackground: string
  surfaceVariant: string
  surfaceContainer: string
  onErrorContainer: string
  inverseSurface: string
  surfaceDim: string
  surface: string
  onTertiaryContainer: string
  onPrimary: string
  outline: string
  onTertiaryFixed: string
  inversePrimary: string
  tertiaryContainer: string
  onPrimaryFixedVariant: string
  onTertiary: string
  error: string
  tertiaryFixed: string
  surfaceTint: string
  primary: string
  onSecondary: string
  secondaryContainer: string
  onSurfaceVariant: string
  onPrimaryContainer: string
  outlineVariant: string
  onSurface: string
  secondaryFixedDim: string
  surfaceContainerLowest: string
  surfaceContainerHighest: string
  onSecondaryContainer: string
  errorContainer: string
  onTertiaryFixedVariant: string
  // Hero card (dark green background) tokens
  heroGradientStart: string
  heroBodyMuted: string
  heroLiveDot: string
  heroCountdownText: string
  heroChipBg: string
  heroPillBg: string
  heroFooterOverlay: string
  heroAvatarBorder: string
  heroSlotBg: string
  heroSlotText: string
  surfaceAlt: string
}

const FOREST_DEFAULT: ProfileThemeColors = {
  surfaceContainerHigh: '#e7e9e5',
  surfaceContainerLow: '#f2f4f1',
  inverseOnSurface: '#eff1ee',
  secondaryFixed: '#cfe8dc',
  onSecondaryFixedVariant: '#354b42',
  surfaceBright: '#f8faf6',
  tertiary: '#00352e',
  secondary: '#4c6359',
  onSecondaryFixed: '#091f18',
  primaryContainer: '#04342C',
  onError: '#ffffff',
  primaryFixed: '#b0f0d6',
  onPrimaryFixed: '#002117',
  tertiaryFixedDim: '#7ad7c6',
  background: '#FFFBF5',
  primaryFixedDim: '#95d3ba',
  onBackground: '#1A2E2A',
  surfaceVariant: '#e1e3e0',
  surfaceContainer: '#eceeeb',
  onErrorContainer: '#93000a',
  inverseSurface: '#2e312f',
  surfaceDim: '#d8dbd7',
  surface: '#FFFFFF',
  onTertiaryContainer: '#65c2b1',
  onPrimary: '#ffffff',
  outline: '#7A8884',
  onTertiaryFixed: '#00201b',
  inversePrimary: '#95d3ba',
  tertiaryContainer: '#004e44',
  onPrimaryFixedVariant: '#0b513d',
  onTertiary: '#ffffff',
  error: '#ba1a1a',
  tertiaryFixed: '#96f3e1',
  surfaceTint: '#0F6E56',
  primary: '#0F6E56',
  onSecondary: '#ffffff',
  secondaryContainer: '#E1F5EE',
  onSurfaceVariant: '#7A8884',
  onPrimaryContainer: '#80bea6',
  outlineVariant: '#E5E3DC',
  onSurface: '#1A2E2A',
  secondaryFixedDim: '#b3ccc0',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerHighest: '#e1e3e0',
  onSecondaryContainer: '#50685d',
  errorContainer: '#ffdad6',
  onTertiaryFixedVariant: '#005046',
  // Hero card (dark green background) tokens
  heroGradientStart: '#083D2B',
  heroBodyMuted: '#A8D9C8',
  heroLiveDot: '#5DCAA5',
  heroCountdownText: '#FFD580',
  heroChipBg: 'rgba(255,255,255,0.15)',
  heroPillBg: 'rgba(0,0,0,0.2)',
  heroFooterOverlay: 'rgba(0,0,0,0.22)',
  heroAvatarBorder: 'rgba(255,255,255,0.3)',
  heroSlotBg: 'rgba(255,255,255,0.12)',
  heroSlotText: 'rgba(255,255,255,0.4)',
  surfaceAlt: '#F5F1E8',
}

export type ProfileThemeId = 'forest-default'

export const PROFILE_THEMES: Record<ProfileThemeId, ProfileThemeColors> = {
  'forest-default': FOREST_DEFAULT,
}

export const DEFAULT_PROFILE_THEME_ID: ProfileThemeId = 'forest-default'

export function getProfileThemeColors(themeId: ProfileThemeId = DEFAULT_PROFILE_THEME_ID): ProfileThemeColors {
  return PROFILE_THEMES[themeId]
}

// Backward-compatible export. Existing code can keep importing this constant.
export const PROFILE_THEME_COLORS = getProfileThemeColors()

export type ProfileThemeSemantic = {
  successBg: string
  successText: string
  warningBg: string
  warningText: string
  warningStrong: string
  infoBg: string
  infoText: string
  infoIcon: string
  dangerBg: string
  dangerText: string
  dangerStrong: string
  dangerBorderSoft: string
  dangerBorder: string
  dangerDeep: string
  overlay: string
  // Rescue / urgent fill card tokens
  rescueAccent: string
  rescueBorder: string
  rescueStrong: string
  rescueSoft: string
}

const FOREST_DEFAULT_SEMANTIC: ProfileThemeSemantic = {
  successBg: '#dcfce7',
  successText: '#0F6E56',
  warningBg: '#FAEEDA',
  warningText: '#854F0B',
  warningStrong: '#EF9F27',
  infoBg: '#e2e8f0',
  infoText: '#475569',
  infoIcon: '#64748b',
  dangerBg: '#FAECE7',
  dangerText: '#be123c',
  dangerStrong: '#e11d48',
  dangerBorderSoft: '#fda4af',
  dangerBorder: '#f3b3b3',
  dangerDeep: '#7a1f1f',
  overlay: 'rgba(10, 20, 30, 0.45)',
  // Rescue / urgent fill card tokens
  rescueAccent: '#D85A30',
  rescueBorder: '#F5D5CB',
  rescueStrong: '#D85A30',
  rescueSoft: '#FDF2F0',
}

export const PROFILE_THEME_SEMANTICS: Record<ProfileThemeId, ProfileThemeSemantic> = {
  'forest-default': FOREST_DEFAULT_SEMANTIC,
}

export function getProfileThemeSemantic(themeId: ProfileThemeId = DEFAULT_PROFILE_THEME_ID): ProfileThemeSemantic {
  return PROFILE_THEME_SEMANTICS[themeId]
}

export const PROFILE_THEME_SEMANTIC = getProfileThemeSemantic()

export type ProfileBadgeTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'

export function getCommunityFeedbackPalette(tone: 'positive' | 'negative', count: number, theme: ProfileThemeColors) {
  const level = count >= 10 ? 'high' : count >= 6 ? 'medium' : 'low'

  if (tone === 'positive') {
    if (level === 'high') {
      return {
        backgroundColor: theme.primary,
        borderColor: theme.surfaceTint,
        textColor: theme.onPrimary,
        iconColor: theme.onPrimary,
      }
    }

    if (level === 'medium') {
      return {
        backgroundColor: theme.surfaceTint,
        borderColor: theme.primary,
        textColor: theme.onPrimary,
        iconColor: theme.onPrimary,
      }
    }

    return {
      backgroundColor: theme.primaryContainer,
      borderColor: theme.surfaceTint,
      textColor: theme.onPrimaryContainer,
      iconColor: theme.onPrimaryContainer,
    }
  }

  if (level === 'high') {
    return {
      backgroundColor: theme.onErrorContainer,
      borderColor: theme.error,
      textColor: theme.onError,
      iconColor: theme.onError,
    }
  }

  if (level === 'medium') {
    return {
      backgroundColor: theme.error,
      borderColor: theme.onErrorContainer,
      textColor: theme.onError,
      iconColor: theme.onError,
    }
  }

  return {
    backgroundColor: (theme as any).dangerDeep || '#7a1f1f', // Fallback if semantic not merged
    borderColor: theme.error,
    textColor: theme.onError,
    iconColor: theme.onError,
  }
}

export function getTrophyBadgePalette(tone: ProfileBadgeTone, theme: ProfileThemeColors) {
  switch (tone) {
    case 'emerald':
      return {
        card: theme.secondaryContainer,
        text: theme.surfaceTint,
        icon: theme.surfaceTint,
      }
    case 'amber':
      return {
        card: theme.primaryFixed,
        text: theme.onPrimaryFixedVariant,
        icon: theme.onPrimaryFixedVariant,
      }
    case 'rose':
      return {
        card: theme.errorContainer,
        text: theme.onErrorContainer,
        icon: theme.error,
      }
    case 'sky':
      return {
        card: theme.tertiaryFixed,
        text: theme.onTertiaryFixedVariant,
        icon: theme.onTertiaryFixedVariant,
      }
    case 'violet':
      return {
        card: theme.secondaryFixed,
        text: theme.onSecondaryFixedVariant,
        icon: theme.onSecondaryFixedVariant,
      }
  }
}

export function getHistoryResultPalette(state: 'win' | 'loss' | 'pending', theme: ProfileThemeColors) {
  switch (state) {
    case 'win':
      return {
        badgeBackground: theme.primary,
        badgeText: theme.onPrimary,
        eloText: theme.primary,
      }
    case 'loss':
      return {
        badgeBackground: theme.errorContainer,
        badgeText: theme.error,
        eloText: theme.error,
      }
    case 'pending':
    default:
      return {
        badgeBackground: theme.surfaceVariant,
        badgeText: theme.onSurfaceVariant,
        eloText: theme.outline,
      }
  }
}
