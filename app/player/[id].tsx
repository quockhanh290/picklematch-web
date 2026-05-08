import { AppButton, AppLoading, EmptyState, SecondaryNavbar, NavbarShareButton } from '@/components/design'
import type { FeedbackTrait } from '@/components/profile/CommunityFeedbackSection'
import CommunityFeedbackPanel from '@/components/profile/CommunityFeedbackSection'
import { ProfileHistoryList, ProfileSkillHero, ProfileWinStreak } from '@/components/profile/ProfileSections'
import { useAppTheme } from '@/lib/theme-context'
import { FEEDBACK_META, calculateReliabilityScore } from '@/features/player/profile/utils'
import { getSkillLevelFromElo, getSkillLevelFromPlayer } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import * as Linking from 'expo-linking'
import { CalendarDays, CircleAlert, MapPin, Share, Swords } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions, Share as RNShare } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SCREEN_FONTS } from '@/constants/typography'

type Player = {
  id: string
  name: string
  city: string | null
  skill_label: string | null
  elo: number
  current_elo?: number | null
  self_assessed_level?: string | null
  is_provisional?: boolean | null
  placement_matches_played?: number | null
  sessions_joined: number
  no_show_count: number
  created_at: string
  favorite_court_ids: string[] | null
}

type PlayerStats = {
  current_win_streak?: number | null
  streak_fire_active?: boolean | null
}

type SessionHistory = {
  id: string
  status: string
  is_host: boolean
  slot: {
    start_time: string
    court: { name: string; city: string }
  }
}

type Court = { id: string; name: string; city: string }

function ProfileSectionDivider({ index, title }: { index: string; title: string }) {
  const theme = useAppTheme()
  return (
    <View className="mb-6 flex-row items-center gap-4">
      <Text
        className="text-[11px] uppercase tracking-[4px]"
        style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}
      >
        {index} / {title}
      </Text>
      <View className="h-px flex-1" style={{ backgroundColor: theme.outlineVariant }} />
    </View>
  )
}

export default function PlayerProfile() {
  const theme = useAppTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()

  const [player, setPlayer] = useState<Player | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [ratingTags, setRatingTags] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<SessionHistory[]>([])
  const [hostedSessionsCount, setHostedSessionsCount] = useState(0)
  const [favCourts, setFavCourts] = useState<Court[]>([])
  const [isMe, setIsMe] = useState(false)
  const [nameFitsOneLine, setNameFitsOneLine] = useState<boolean | null>(null)
  const [nameMeasureWidth, setNameMeasureWidth] = useState(0)

  const fetchRatingTags = useCallback(async (playerId: string) => {
    const nowIso = new Date().toISOString()
    const { data } = await supabase
      .from('ratings')
      .select('tags, is_hidden, reveal_at')
      .eq('rated_id', playerId)
      .or(`is_hidden.eq.false,reveal_at.lte.${nowIso}`)

    if (!data) return

    const counts: Record<string, number> = {}
    data.forEach((rating: any) => {
      rating.tags?.forEach((tag: string) => {
        counts[tag] = (counts[tag] ?? 0) + 1
      })
    })
    setRatingTags(counts)
  }, [])

  const fetchHistory = useCallback(async (playerId: string) => {
    const { data } = await supabase
      .from('session_players')
      .select(
        `
        session:session_id (
          id, status, host_id,
          slot:slot_id (
            start_time,
            court:court_id ( name, city )
          )
        )
      `,
      )
      .eq('player_id', playerId)
      .limit(5)

    if (!data) {
      setHistory([])
      return
    }

    setHistory(
      data
        .map((item: any) => ({
          id: item.session.id,
          status: item.session.status,
          is_host: item.session.host_id === playerId,
          slot: item.session.slot,
        }))
        .sort(
          (a: SessionHistory, b: SessionHistory) =>
            new Date(b.slot.start_time).getTime() - new Date(a.slot.start_time).getTime(),
        )
        .slice(0, 5),
    )
  }, [])

  const fetchFavCourts = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setFavCourts([])
      return
    }
    const { data } = await supabase.from('courts').select('id, name, city').in('id', ids)
    setFavCourts(data ?? [])
  }, [])

  const fetchHostedSessionsCount = useCallback(async (playerId: string) => {
    const { count, error } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', playerId)

    if (error) {
      console.warn('[PlayerProfile] hosted session count query failed:', error.message)
      return
    }

    setHostedSessionsCount(count ?? 0)
  }, [])

  const fetchAll = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }

    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setIsMe(user?.id === id)

    const [{ data: playerData }, { data: statsData }] = await Promise.all([
      supabase
        .from('players')
        .select(
          'id, name, city, skill_label, self_assessed_level, elo, current_elo, is_provisional, placement_matches_played, sessions_joined, no_show_count, created_at, favorite_court_ids',
        )
        .eq('id', id)
        .single(),
      supabase.from('player_stats').select('current_win_streak, streak_fire_active').eq('player_id', id).maybeSingle(),
    ])

    if (!playerData) {
      setPlayer(null)
      setPlayerStats(null)
      setHistory([])
      setFavCourts([])
      setRatingTags({})
      setHostedSessionsCount(0)
      setLoading(false)
      return
    }

    setPlayer(playerData)
    setPlayerStats(statsData ?? null)

    await Promise.all([
      fetchRatingTags(playerData.id),
      fetchHistory(playerData.id),
      fetchHostedSessionsCount(playerData.id),
      fetchFavCourts(playerData.favorite_court_ids ?? []),
    ])

    setLoading(false)
  }, [fetchFavCourts, fetchHistory, fetchHostedSessionsCount, fetchRatingTags, id])

  useFocusEffect(
    useCallback(() => {
      void fetchAll()
    }, [fetchAll]),
  )

  const communityTraits = useMemo<FeedbackTrait[]>(() => {
    return Object.entries(ratingTags)
      .map(([key, count]) => {
        const meta = FEEDBACK_META[key]
        if (!meta) return null
        return {
          key,
          icon: meta.icon,
          label: meta.label,
          count: `${meta.tone === 'positive' ? '+' : '-'}${count} ghi nhận`,
          context: meta.context,
          tone: meta.tone,
        }
      })
      .filter((item): item is FeedbackTrait => Boolean(item))
      .sort((a, b) => {
        const aCount = Number.parseInt(a.count.replace(/[^\d]/g, ''), 10)
        const bCount = Number.parseInt(b.count.replace(/[^\d]/g, ''), 10)
        return bCount - aCount
      })
      .slice(0, 4)
  }, [ratingTags])

  if (loading) {
    return <AppLoading fullScreen />
  }

  if (!player) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: theme.background }} edges={['top']}>
        <EmptyState
          icon={<CircleAlert size={28} color={theme.outline} />}
          title="Không tìm thấy người chơi"
          description="Thử tải lại hoặc quay về trang trước để kiểm tra danh sách."
        />
      </SafeAreaView>
    )
  }

  const reliability = calculateReliabilityScore(player.sessions_joined, player.no_show_count)
  const effectiveElo = player.current_elo ?? player.elo
  const calibratedSkill = getSkillLevelFromElo(effectiveElo)
  const fallbackSkill = getSkillLevelFromPlayer(player)
  const skill = calibratedSkill ?? fallbackSkill
  const placementPlayed = player.placement_matches_played ?? 0
  const currentWinStreak = playerStats?.current_win_streak ?? 0
  const streakActive = playerStats?.streak_fire_active ?? currentWinStreak > 0
  const nameParts = (player.name || '').trim().split(/\s+/).filter(Boolean)
  const headlineMainName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : player.name
  const headlineSubName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
  const joinedYear = player.created_at ? new Date(player.created_at).getFullYear() : null
  const editorialNameSize = width < 360 ? 42 : width < 420 ? 50 : 58
  const editorialNameLineHeight = width < 360 ? 52 : width < 420 ? 62 : 72
  const shouldUseSplitEditorialName = Boolean(headlineSubName) && nameFitsOneLine === false

  function formatTime(start: string) {
    const date = new Date(start)
    const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()]
    const day = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`
    const hh = date.getHours().toString().padStart(2, '0')
    const mm = date.getMinutes().toString().padStart(2, '0')
    return `${weekday} ${day} · ${hh}:${mm}`
  }

  async function handleShare() {
    try {
      const url = Linking.createURL(`/player/${id}`)
      await RNShare.share({ message: `Xem hồ sơ người chơi Pickleball này nhé! ${url}` })
    } catch (error) {
      console.warn('[PlayerProfile] Failed to share profile:', error)
    }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SecondaryNavbar
        title="CHI TIẾT NGƯỜI CHƠI"
        onBackPress={() => router.back()}
        rightSlot={<NavbarShareButton onPress={handleShare} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 72 }}>

        <View className="px-6 pt-6">
          <View>
            <View
              style={{ paddingTop: 6, paddingBottom: 4 }}
              onLayout={(event) => {
                const measuredWidth = event.nativeEvent.layout.width
                if (Math.abs(measuredWidth - nameMeasureWidth) > 1) {
                  setNameMeasureWidth(measuredWidth)
                }
              }}
            >
              {nameMeasureWidth > 0 ? (
                <Text
                  onTextLayout={(event) => {
                    const nextFits = event.nativeEvent.lines.length <= 1
                    if (nextFits !== nameFitsOneLine) setNameFitsOneLine(nextFits)
                  }}
                  style={{
                    position: 'absolute',
                    opacity: 0,
                    left: 0,
                    right: 0,
                    color: theme.primary,
                    fontFamily: SCREEN_FONTS.headline,
                    fontSize: editorialNameSize,
                    lineHeight: editorialNameLineHeight,
                    letterSpacing: -2,
                  }}
                >
                  {player.name}
                </Text>
              ) : null}

              {shouldUseSplitEditorialName ? (
                <>
                  <Text
                    style={{
                      color: theme.primary,
                      fontFamily: SCREEN_FONTS.headline,
                      fontSize: editorialNameSize,
                      lineHeight: editorialNameLineHeight,
                      letterSpacing: -2,
                    }}
                  >
                    {headlineMainName}
                  </Text>
                  <Text
                    style={{
                      color: theme.outlineVariant,
                      opacity: 0.55,
                      fontFamily: SCREEN_FONTS.headlineItalic,
                      fontSize: editorialNameSize,
                      lineHeight: editorialNameLineHeight,
                      letterSpacing: -2,
                      marginTop: -4,
                    }}
                  >
                    {headlineSubName}
                  </Text>
                </>
              ) : (
                <Text
                  style={{
                    color: theme.primary,
                    fontFamily: SCREEN_FONTS.headline,
                    fontSize: editorialNameSize,
                    lineHeight: editorialNameLineHeight,
                    letterSpacing: -2,
                  }}
                >
                  {player.name}
                </Text>
              )}
            </View>

            <View className="mt-3 flex-row flex-wrap items-center gap-3">
              <Text
                className="rounded-full px-4 py-1 text-[10px] uppercase tracking-[2px]"
                style={{
                  color: theme.onPrimaryFixed,
                  backgroundColor: theme.primaryFixed,
                  fontFamily: SCREEN_FONTS.cta,
                }}
              >
                {player.is_provisional ? `${placementPlayed}/5 placement` : 'Verified Player'}
              </Text>
              {player.city ? (
                <Text className="text-sm" style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta }}>
                  {player.city}
                </Text>
              ) : null}
              <Text className="text-sm" style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta }}>
                Thành viên từ {joinedYear ?? 'N/A'}
              </Text>
            </View>

            <View className="mt-3">
              <Text
                className="self-start rounded-full px-4 py-1 text-[10px] uppercase tracking-[2px]"
                style={{
                  color: theme.onPrimaryContainer,
                  backgroundColor: theme.primaryContainer,
                  fontFamily: SCREEN_FONTS.cta,
                }}
              >
                Độ tin cậy · {reliability === null ? '--' : `${reliability}%`}
              </Text>
            </View>

            <Text
              className="mt-4 text-base leading-7"
              style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body }}
            >
              Hồ sơ công khai hiển thị phong cách thi đấu, độ ổn định và nhịp tham gia kèo của người chơi này.
            </Text>

            <View className="mt-4">
              <ProfileSkillHero
                elo={effectiveElo}
                title={skill?.title ?? 'Đang hiệu chỉnh'}
                subtitle={
                  skill?.subtitle ??
                  'Mức khởi điểm hiện tại. Hệ thống sẽ tiếp tục tinh chỉnh sau vài trận.'
                }
                description={
                  skill?.description ??
                  'Hệ thống đang dùng Elo và tín hiệu sau trận để tinh chỉnh nhịp ghép kèo phù hợp hơn.'
                }
                levelId={skill?.id}
                colors={{
                  gradientStart: theme.primary,
                  gradientEnd: theme.surfaceTint,
                  bubble: 'rgba(255,255,255,0.14)',
                  watermark: 'rgba(255,255,255,0.14)',
                  eloChipBg: theme.primaryFixed,
                  eloChipText: theme.onPrimaryFixed,
                  title: theme.onPrimary,
                  description: theme.inverseOnSurface,
                }}
                contentRightInset={16}
              />
            </View>
          </View>

          <View className="mb-10 gap-4">
            <ProfileSectionDivider index="01" title="TỔNG QUAN" />
            <View className="flex-row justify-between gap-4">
              <View className="flex-1 rounded-[24px] p-4" style={{ backgroundColor: theme.surfaceContainerLow }}>
                <Swords size={22} color={theme.primary} />
                <Text className="mt-4 text-[28px]" style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta }}>
                  {player.sessions_joined ?? 0}
                </Text>
                <Text
                  className="mt-1 text-[12px] uppercase tracking-[2px]"
                  style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}
                >
                  Trận đấu
                </Text>
              </View>

              <View className="flex-1 rounded-[24px] p-4" style={{ backgroundColor: theme.secondaryContainer }}>
                <CalendarDays size={22} color={theme.surfaceTint} />
                <Text className="mt-4 text-[28px]" style={{ color: theme.surfaceTint, fontFamily: SCREEN_FONTS.cta }}>
                  {hostedSessionsCount}
                </Text>
                <Text
                  className="mt-1 text-[12px] uppercase tracking-[2px]"
                  style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta }}
                >
                  Đã host
                </Text>
              </View>
            </View>
          </View>

          <ProfileWinStreak current={currentWinStreak} active={streakActive} />

          <View className="mt-0 mb-6">
            <ProfileSectionDivider index="02" title="CỘNG ĐỒNG" />
            {communityTraits.length > 0 ? (
              <CommunityFeedbackPanel title="" traits={communityTraits} flushBottom />
            ) : (
              <EmptyState
                icon={<CircleAlert size={28} color={theme.outline} />}
                title="Chưa có đánh giá nào"
                description="Sau khi chơi thêm vài kèo, phản hồi từ cộng đồng sẽ xuất hiện ở đây."
              />
            )}
          </View>

          <View className="mb-6">
            <ProfileSectionDivider index="03" title="SÂN QUEN" />
            {favCourts.length > 0 ? (
              <View className="gap-3">
                {favCourts.map((court) => (
                  <View
                    key={court.id}
                    className="rounded-[20px] p-4"
                    style={{ backgroundColor: theme.surfaceContainerLowest }}
                  >
                    <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta, fontSize: 16 }}>
                      {court.name}
                    </Text>
                    <View className="mt-2 flex-row items-center">
                      <MapPin size={12} color={theme.outline} />
                      <Text className="ml-1" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.body, fontSize: 12 }}>
                        {court.city}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                icon={<MapPin size={28} color={theme.outline} />}
                title="Chưa có sân thường chơi"
                description="Thông tin sân quen sẽ xuất hiện ở đây khi người chơi lưu sân yêu thích."
              />
            )}
          </View>

          <View>
            <ProfileSectionDivider index="04" title="LỊCH SỬ" />
            {history.length > 0 ? (
              <ProfileHistoryList
                title="Lịch sử trận đấu"
                subtitle="Nhịp trận gần nhất của người chơi này"
                items={history}
                formatTime={formatTime}
                hideHeader
                flushBottom
              />
            ) : (
              <EmptyState
                icon={<CalendarDays size={28} color={theme.outline} />}
                title="Chưa tham gia kèo nào"
                description="Khi người chơi tham gia hoặc host kèo, lịch sử sẽ hiện ở đây."
              />
            )}
          </View>

          {isMe ? (
            <View className="mt-8">
              <View
                style={{ backgroundColor: theme.secondaryFixed }}
                className="rounded-full px-5 py-3 items-center"
              >
                <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta }}>
                  Bạn đang xem hồ sơ công khai của chính mình
                </Text>
              </View>
              <View className="mt-3">
                <AppButton
                  label="Về hồ sơ cá nhân"
                  onPress={() => router.replace('/(tabs)/profile' as any)}
                  variant="secondary"
                />
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}


