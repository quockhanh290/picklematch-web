import type { TrophyBadge } from '@/components/profile/TrophyRoom'

export type ProfilePlayer = {
  id: string
  name: string
  phone: string
  city: string
  skill_label: string
  elo: number
  current_elo?: number | null
  self_assessed_level?: string | null
  is_provisional?: boolean | null
  placement_matches_played?: number | null
  sessions_joined: number
  no_show_count: number
  created_at: string
  bio?: string | null
  is_host?: boolean | null
  gender?: 'male' | 'female' | null
  avatar_url?: string | null
}

export type ProfilePlayerStats = {
  current_win_streak: number
  streak_fire_active: boolean
  win_rate?: number | null
}

export type ProfileSessionHistory = {
  id: string
  status: string
  is_host: boolean
  slot: {
    start_time: string
    end_time: string
    court: { name: string; city: string }
  }
}

export type ProfileAchievementRow = {
  badge_key: string
  badge_title: string
  badge_category: TrophyBadge['category']
  badge_description: string | null
  icon: string | null
  earned_at: string
  meta?: { requirement?: string } | null
}

export type ProfileDataSnapshot = {
  loggedIn: boolean
  player: ProfilePlayer | null
  playerStats: ProfilePlayerStats | null
  ratingTags: Record<string, number>
  achievements: TrophyBadge[]
  history: ProfileSessionHistory[]
  hostedSessionsCount: number
  isOwner: boolean
  // Flat computed convenience fields for ProfileScreen UI
  name: string
  skillLabel: string
  currentElo: number
  winStreak: number
}
