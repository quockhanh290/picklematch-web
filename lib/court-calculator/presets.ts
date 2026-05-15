import type { CourtPreset } from './types'

export const PRESETS: Record<
  CourtPreset,
  { matches: number; label: string; description: string }
> = {
  play_more: {
    matches: 5.5,
    label: 'Choi nhieu',
    description: '5-6 tran/nguoi',
  },
  balanced: {
    matches: 4.5,
    label: 'Can bang',
    description: '4-5 tran/nguoi',
  },
  relaxed: {
    matches: 3,
    label: 'Thu gian',
    description: '3 tran/nguoi',
  },
}

