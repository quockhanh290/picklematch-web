import type { CourtPreset } from './types'

export const PRESETS: Record<
  CourtPreset,
  { matches: number; label: string; description: string }
> = {
  play_more: {
    matches: 5.5,
    label: 'Chơi nhiều',
    description: '5-6 trận/người',
  },
  balanced: {
    matches: 4.5,
    label: 'Cân bằng',
    description: '4-5 trận/người',
  },
  relaxed: {
    matches: 3,
    label: 'Thư giãn',
    description: '3 trận/người',
  },
}

