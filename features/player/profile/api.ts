import { supabase } from '@/lib/supabase'
import type { 
    ProfileAchievementRow, 
    ProfileDataSnapshot, 
    ProfilePlayer, 
    ProfilePlayerStats, 
    ProfileSessionHistory 
} from './types'
import { 
    BADGE_REQUIREMENTS, 
    formatBadgeDate, 
    getBadgeIcon, 
    getBadgeTone 
} from './utils'

let profileDataCache:
  | {
      userId: string
      updatedAt: number
      snapshot: ProfileDataSnapshot
    }
  | null = null

const PROFILE_CACHE_FRESH_MS = 30_000

export async function fetchCurrentPlayerProfileDataApi(options?: { force?: boolean }): Promise<ProfileDataSnapshot> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { loggedIn: false, player: null, playerStats: null, ratingTags: {}, achievements: [], history: [], hostedSessionsCount: 0, isOwner: false }
  }

  if (!options?.force && profileDataCache?.userId === user.id && Date.now() - profileDataCache.updatedAt < PROFILE_CACHE_FRESH_MS) {
    return profileDataCache.snapshot
  }

  const nowIso = new Date().toISOString()
  const [playerRes, statsRes, ratingsRes, achievementsRes, historyRes, hostedCountRes, ownerRes] = await Promise.all([
    supabase.from('players').select('*').eq('id', user.id).single(),
    supabase.from('player_stats').select('current_win_streak, streak_fire_active').eq('player_id', user.id).maybeSingle(),
    supabase.from('ratings').select('tags, is_hidden, reveal_at').eq('rated_id', user.id).or(`is_hidden.eq.false,reveal_at.lte.${nowIso}`),
    supabase.from('player_achievements').select('badge_key, badge_title, badge_category, badge_description, icon, earned_at, meta').eq('player_id', user.id).order('earned_at', { ascending: false }),
    supabase.from('session_players').select(`
        status,
        session:session_id (
          id, status, host_id,
          slot:slot_id (
            start_time, end_time,
            court:court_id ( name, city )
          )
        )
      `).eq('player_id', user.id).limit(20),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('host_id', user.id),
    supabase.from('owners').select('id').eq('id', user.id).maybeSingle(),
  ])

  if (statsRes.error) console.warn('[Profile] player stats query failed:', statsRes.error.message)
  if (ratingsRes.error) console.warn('[Profile] ratings query failed:', ratingsRes.error.message)
  if (achievementsRes.error) console.warn('[Profile] achievements query failed:', achievementsRes.error.message)
  if (historyRes.error) console.warn('[Profile] session history query failed:', historyRes.error.message)
  if (hostedCountRes.error) console.warn('[Profile] hosted session count query failed:', hostedCountRes.error.message)

  const ratingTags: Record<string, number> = {}
  ;(ratingsRes.data ?? []).forEach((rating: any) => {
    rating.tags?.forEach((tag: string) => {
      ratingTags[tag] = (ratingTags[tag] ?? 0) + 1
    })
  })

  const achievements = ((achievementsRes.data ?? []) as ProfileAchievementRow[]).map((badge) => ({
    key: badge.badge_key,
    title: badge.badge_title,
    category: badge.badge_category,
    description: badge.badge_description ?? 'Danh hiệu mở khóa từ kết quả và uy tín trong hệ thống.',
    requirement: badge.meta?.requirement ?? BADGE_REQUIREMENTS[badge.badge_key] ?? 'Đạt mốc hệ thống',
    icon: getBadgeIcon(badge.icon),
    tone: getBadgeTone(badge.badge_category),
    earned: true,
    earnedAt: formatBadgeDate(badge.earned_at),
  }))

  const history = ((historyRes.data ?? []) as any[])
    .map((item) => ({
      id: item.session.id,
      status: item.session.status,
      is_host: item.session.host_id === user.id,
      slot: item.session.slot,
    }))
    .sort((a: ProfileSessionHistory, b: ProfileSessionHistory) => new Date(b.slot.start_time).getTime() - new Date(a.slot.start_time).getTime())
  const playerData = (playerRes.data as ProfilePlayer | null) ?? null
  const statsData = (statsRes.data ?? null) as ProfilePlayerStats | null
  const snapshot: ProfileDataSnapshot = {
    loggedIn: true,
    player: playerData,
    playerStats: statsData,
    ratingTags,
    achievements,
    history,
    hostedSessionsCount: hostedCountRes.count ?? 0,
    isOwner: Boolean(ownerRes?.data),
    // Flat convenience fields for ProfileScreen UI
    name: playerData?.name ?? '',
    skillLabel: playerData?.skill_label ?? 'Unranked',
    currentElo: playerData?.current_elo ?? playerData?.elo ?? 0,
    winStreak: statsData?.current_win_streak ?? 0,
  }

  profileDataCache = { userId: user.id, updatedAt: Date.now(), snapshot }
  return snapshot
}

export function clearCurrentPlayerProfileCacheApi() {
  profileDataCache = null
}
