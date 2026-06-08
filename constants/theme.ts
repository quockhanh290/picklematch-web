import { Platform } from 'react-native';
import {
  DEFAULT_PROFILE_THEME_ID,
  getProfileThemeColors,
  getProfileThemeSemantic,
  PROFILE_THEMES,
  type ProfileThemeColors,
  type ProfileThemeId,
  type ProfileThemeSemantic,
} from './profileTheme';

export type AppTheme = ProfileThemeColors & ProfileThemeSemantic & {
  id: string;
  name: string;
  // Semantic aliases (existing ones kept for backward compatibility)
  backgroundMuted: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSoft: string;
  primaryStrong: string;
  primarySoft: string;
  primaryContrast: string;
  surfaceMuted: string;
  shadow: string;
  warningSoft: string;
  warning: string;
  warningContainer: string;
  onWarningContainer: string;
  dangerSoft: string;
  danger: string;
  dangerContainer: string;
  infoSoft: string;
  info: string;
  infoContainer: string;
  successSoft: string;
  success: string;
  successContainer: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
};

function createAppThemeFromProfile(id: string, name: string, p: ProfileThemeColors, s: ProfileThemeSemantic): AppTheme {
  return {
    ...p,
    ...s,
    id,
    name,
    // Keep semantic aliases for existing useAppTheme callers
    backgroundMuted: p.surfaceContainerLow,
    surfaceAlt: p.surfaceAlt,
    border: p.outlineVariant,
    borderStrong: p.outline,
    text: p.onSurface,
    textMuted: p.onSurfaceVariant,
    textSoft: p.outline,
    primaryStrong: p.primaryContainer,
    primarySoft: p.secondaryContainer,
    primaryContrast: p.onPrimary,
    surfaceMuted: p.surfaceContainerHigh,
    shadow: '#000000',
    warningSoft: s.warningBg,
    warning: s.warningStrong,
    warningContainer: s.warningBg,
    onWarningContainer: s.warningText,
    dangerSoft: s.dangerBg,
    danger: s.dangerStrong,
    dangerContainer: s.dangerBg,
    infoSoft: s.infoBg,
    info: s.infoText,
    infoContainer: s.infoBg,
    successSoft: s.successBg,
    success: s.successText,
    successContainer: s.successBg,
    radiusSm: 18,
    radiusMd: 28,
    radiusLg: 32,
  }
}

export type AppThemeId = ProfileThemeId

export const AppThemes: Record<AppThemeId, AppTheme> = (Object.keys(PROFILE_THEMES) as AppThemeId[]).reduce(
  (acc, themeId) => {
    const profile = getProfileThemeColors(themeId)
    const semantic = getProfileThemeSemantic(themeId)
    acc[themeId] = createAppThemeFromProfile(themeId, `Profile Theme (${themeId})`, profile, semantic)
    return acc
  },
  {} as Record<AppThemeId, AppTheme>,
)

export const defaultAppTheme = AppThemes[DEFAULT_PROFILE_THEME_ID];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
