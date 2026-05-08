/**
 * UI Utility Functions
 * Centralized helpers for colors, formatting, and layout calculations.
 */

/**
 * Converts a hex color string to an RGB object.
 * @param hex The hex color code (e.g., '#FFFFFF' or '#FFF').
 */
export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(value, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Adds alpha transparency to a hex color string.
 * @param hex The hex color code (e.g., '#FFFFFF' or '#FFF').
 * @param alpha The opacity value from 0 to 1.
 * @returns An rgba string.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return hex
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Normalizes text for searching by removing diacritics and converting to lowercase.
 * @param value The text to normalize.
 */
export function normalizeText(value?: string | null) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}
