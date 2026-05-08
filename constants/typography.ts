/**
 * Global Typography System - Single Source of Truth
 */


export const SCREEN_FONTS = {
  /** BarlowCondensed 700 — court names, time ranges, section headers, price, buttons */
  headline: 'BarlowCondensed-Bold',
  /** BarlowCondensed 700 Italic — step titles, hero display numbers */
  headlineItalic: 'BarlowCondensed-BoldItalic',
  /** BarlowCondensed 900 — player count selectors, heavy accent numerals */
  headlineBlack: 'BarlowCondensed-Black',
  /** PlusJakartaSans 400 — addresses, descriptions, secondary body copy */
  body: 'PlusJakartaSans-Regular',
  /** PlusJakartaSans 500 — medium emphasis body */
  medium: 'PlusJakartaSans-Medium',
  /** PlusJakartaSans 600 — host name, booking status, chips, metadata */
  label: 'PlusJakartaSans-SemiBold',
  /** BarlowCondensed 700 — primary action text, tab headers */
  cta: 'BarlowCondensed-Bold',
  /** PlusJakartaSans 800 — hero court names, player names, section dividers */
  bold: 'PlusJakartaSans-ExtraBold',
  /** PlusJakartaSans 800 Italic — time range hero display in detail cards */
  boldItalic: 'PlusJakartaSans-ExtraBoldItalic',
} as const

export const AppFontSet = {
  display: SCREEN_FONTS.headlineItalic,
  headline: SCREEN_FONTS.headline,
  title: SCREEN_FONTS.headline,
  body: SCREEN_FONTS.body,
  label: SCREEN_FONTS.label,
  cta: SCREEN_FONTS.cta,
} as const

export const typography = {
  // Display - large numbers, court names
  displayLg: { fontFamily: SCREEN_FONTS.headline, fontSize: 26, lineHeight: 28, letterSpacing: 0.3 },
  displayMd: { fontFamily: SCREEN_FONTS.headline, fontSize: 22, lineHeight: 24, letterSpacing: 0.3 },
  displaySm: { fontFamily: SCREEN_FONTS.headline, fontSize: 18, lineHeight: 20, letterSpacing: 0.3 },

  // Body
  bodyMd: { fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 18 },
  bodySm: { fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16 },
  bodyXs: { fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 14 },

  // Label
  labelMd: { fontFamily: SCREEN_FONTS.label, fontSize: 13, lineHeight: 18 },
  labelSm: { fontFamily: SCREEN_FONTS.label, fontSize: 11, lineHeight: 14 },

  // CTA
  cta: { 
    fontFamily: SCREEN_FONTS.cta, 
    fontSize: 15, 
    lineHeight: 20, 
    letterSpacing: 1.3, 
    textTransform: 'uppercase' as const
  },
} as const

export type ScreenFontKey = keyof typeof SCREEN_FONTS
