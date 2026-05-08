import { colors as pickleballTropicColors } from '@/constants/colors'

export type ThemeOptionId = 'pickleball-tropic'

export type ThemeOption = {
  id: ThemeOptionId
  name: string
  description: string
  colors: typeof pickleballTropicColors
}

export const THEME_OPTIONS: Record<ThemeOptionId, ThemeOption> = {
  'pickleball-tropic': {
    id: 'pickleball-tropic',
    name: 'Pickleball Tropic',
    description: 'Teal-first tropical palette for pickleball booking flows',
    colors: pickleballTropicColors,
  },
}

export const DEFAULT_THEME_OPTION_ID: ThemeOptionId = 'pickleball-tropic'

export function getThemeOption(themeId: ThemeOptionId = DEFAULT_THEME_OPTION_ID): ThemeOption {
  return THEME_OPTIONS[themeId]
}

