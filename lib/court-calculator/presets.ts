// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { CourtPreset } from './types.ts'

export const PRESETS: Record<
  CourtPreset,
  { label: string; description: string }
> = {
  play_more: {
    label: 'Chơi nhiều',
    description: '5-6 trận/người',
  },
  balanced: {
    label: 'Cân bằng',
    description: '4-5 trận/người',
  },
  relaxed: {
    label: 'Thư giãn',
    description: '3 trận/người',
  },
}

export const PRESET_ROTATION_TARGETS: Record<
  CourtPreset,
  { ideal: number; min: number; max: number }
> = {
  relaxed: { ideal: 0.55, min: 0.4, max: 0.7 },
  balanced: { ideal: 0.7, min: 0.55, max: 0.8 },
  play_more: { ideal: 0.82, min: 0.65, max: 0.95 },
}

export function getCourtPresetTargetMatches(preset: CourtPreset, totalRounds: number): number {
  const rounds = Math.max(0, Math.floor(totalRounds))
  return Number((rounds * PRESET_ROTATION_TARGETS[preset].ideal).toFixed(1))
}
