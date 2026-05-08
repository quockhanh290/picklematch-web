export const colors = {
  // Brand
  primary: '#0F6E56',
  primaryLight: '#E1F5EE',
  primaryDark: '#04342C',

  // Accent
  accent: '#FF6B6B',
  accentLight: '#FAECE7',
  accentDark: '#993C1D',

  // Warning
  warning: '#EF9F27',
  warningLight: '#FAEEDA',
  warningDark: '#854F0B',

  // Neutral
  text: '#1A2E2A',
  textSecondary: '#7A8884',
  textMuted: '#B4B2A9',

  // Surface
  background: '#FFFBF5',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F1E8',
  border: '#E5E3DC',

  // Status
  success: '#1D9E75',
  successText: '#0F6E56',

  // Backward-compatible aliases
  brandPrimary: '#0F6E56',
  brandPrimaryBg: '#E1F5EE',
  brandPrimaryText: '#0F6E56',
  brandPrimaryDark: '#04342C',
  accentCoral: '#FF6B6B',
  accentCoralBg: '#FAECE7',
  accentCoralText: '#993C1D',
  accentCoralDark: '#4A1B0C',
  statusWarn: '#EF9F27',
  statusWarnBg: '#FAEEDA',
  statusWarnText: '#854F0B',
  textPrimary: '#1A2E2A',
  bgCard: '#FFFFFF',
  bgCanvas: '#FFFBF5',
  bgTimeBlock: '#F5F1E8',
  borderSubtle: '#E5E3DC',
  liveGreen: '#1D9E75',
} as const

export type PickleballTropicColors = typeof colors
