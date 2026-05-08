import { router } from 'expo-router'
import React, { memo, useCallback, useState } from 'react'
import {   RefreshControl, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { FamiliarCourtCard } from '@/components/home/FamiliarCourtCard'
import { HomeCarouselSection } from '@/components/home/HomeCarouselSection'
import { HomeGreetingHeader } from '@/components/home/HomeGreetingHeader'
import { MatchSessionCard } from '@/components/home/MatchSessionCard'
import { PostMatchInboxSection } from '@/components/home/PostMatchInboxSection'
import { ExpandingCreateButton } from '@/components/sessions/ExpandingCreateButton'
import { AppLoading } from '@/components/design/AppLoading'
import { SCREEN_FONTS } from '@/constants/typography'
import { useHomeFeedData } from './hooks/useHomeFeedData'
import type { FamiliarCourt, MatchSession } from '@/lib/homeFeed'
import { useAppTheme } from '@/lib/theme-context'
import { useAuth } from '@/lib/useAuth'
import { SPACING } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { withAlpha } from '@/lib/utils/ui'
import { WebContainer } from '@/components/design/WebContainer'
import { useRoleSwitcher } from '@/lib/useRoleSwitcher'

const CAROUSEL_SECTION_HEIGHT = 430
const COURT_CAROUSEL_HEIGHT = 272


const SmartMatchCard = memo(function SmartMatchCard({ item, accentMode = 'default' }: { item: MatchSession; accentMode?: 'default' | 'rescue' }) {
  return <MatchSessionCard item={item} variant="standard" actionLabel={item.joined ? STRINGS.home.actions.view_session : STRINGS.home.actions.join_session} accentMode={accentMode} />
})

const SmartQueueHeroStyledCard = memo(function SmartQueueHeroStyledCard({ item }: { item: MatchSession }) {
  return <MatchSessionCard item={item} variant="smart" actionLabel={item.joined ? STRINGS.home.actions.view_session : STRINGS.home.actions.prioritize_match} />
})

const HeroThemeCard = memo(function HeroThemeCard({
  item,
  actionLabel,
}: {
  item: MatchSession
  actionLabel: string
}) {
  return <MatchSessionCard item={item} variant="hero" actionLabel={actionLabel} />
})

const HomeStreakCard = memo(function HomeStreakCard({ current }: { current: number }) {
  const theme = useAppTheme()
  if (current <= 0) return null

  if (current < 3) {
    const remaining = 3 - current

    return (
      <View
        className="mt-4 flex-row items-center rounded-[10px] border"
        style={{ paddingHorizontal: SPACING.md, paddingVertical: 9, borderColor: theme.secondaryFixedDim, backgroundColor: theme.surface, columnGap: 8 }}
      >
        <Text style={{ fontSize: 15, lineHeight: 18 }}>🔥</Text>
        <Text className="min-w-0 flex-1 text-[12px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.label, lineHeight: 17 }}>
          {STRINGS.home.streak.label}{' '}
          <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta }}>{current}</Text>
          {' '}ngày · {STRINGS.home.streak.remaining_badge.replace('{count}', remaining.toString())}
        </Text>
        <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14, lineHeight: 18 }}>›</Text>
      </View>
    )
  }

  const filledPips = Math.min(current, 10)

  return (
    <View
      className="mt-4 flex-row items-center rounded-[10px]"
      style={{ paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: theme.primary, columnGap: 12 }}
    >
      <Text style={{ fontSize: 22, lineHeight: 26 }}>🔥</Text>

      <View className="min-w-0 flex-1">
        <Text
          className="mb-1 text-[10px] uppercase"
          style={{ color: theme.secondaryFixed, fontFamily: SCREEN_FONTS.label, letterSpacing: 0.5, lineHeight: 14 }}
        >
          {STRINGS.home.sections.streak}
        </Text>
        <View className="flex-row" style={{ columnGap: 4 }}>
          {Array.from({ length: 10 }).map((_, index) => (
            <View
              key={index}
              className="h-1 flex-1 rounded-full"
              style={{ backgroundColor: index < filledPips ? theme.tertiary : withAlpha(theme.onPrimary, 0.15) }}
            />
          ))}
        </View>
      </View>

      <View className="items-center">
        <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 24, lineHeight: 24 }}>
          {current}
        </Text>
        <Text className="mt-px text-[9px]" style={{ color: theme.secondaryFixed, fontFamily: SCREEN_FONTS.body, lineHeight: 12, textAlign: 'center' }}>
          {STRINGS.home.streak.days.replace('{count}', '').trim()}
        </Text>
      </View>
    </View>
  )
})

export function HomeScreen() {
  const insets = useSafeAreaInsets()
  const theme = useAppTheme()
  const { userId, isLoading: isAuthLoading } = useAuth()
  const { switchToHost } = useRoleSwitcher()
  const [personalizedIndex, setPersonalizedIndex] = useState(0)
  const [rescueIndex, setRescueIndex] = useState(0)
  const [courtIndex, setCourtIndex] = useState(0)
  const {
    refreshing,
    loading,
    profile,
    playerStats,
    nextMatch,
    pendingMatches,
    postMatchActions,
    personalizedSessions,
    rescueSessions,
    familiarCourts,
    isFirstLoad,
    onRefresh,
  } = useHomeFeedData(userId, isAuthLoading)

  const upcomingMatch = nextMatch
  const hasUpcomingMatch = Boolean(upcomingMatch)
  const currentWinStreak = playerStats?.current_win_streak ?? 0
  const displayWinStreak = currentWinStreak
  const statusPrompt = hasUpcomingMatch ? STRINGS.home.prompts.ready : STRINGS.home.prompts.join_today

  const renderPersonalizedCard = useCallback(
    (item: MatchSession) => (hasUpcomingMatch ? <SmartMatchCard item={item} /> : <SmartQueueHeroStyledCard item={item} />),
    [hasUpcomingMatch],
  )
  const renderRescueCard = useCallback((item: MatchSession) => <SmartMatchCard item={item} accentMode="rescue" />, [])
  const renderCourtCard = useCallback(
    (item: FamiliarCourt) => (
      <FamiliarCourtCard
        item={item}
        onPress={() =>
          router.push({
            pathname: '/court/[id]',
            params: { id: item.id },
          } as any)
        }
      />
    ),
    [],
  )

  if (loading && isFirstLoad && !refreshing) {
    return <AppLoading fullScreen />
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={theme.primary} 
            colors={[theme.primary]}
            title={STRINGS.common.loading}
            titleColor={theme.onSurfaceVariant}
            progressViewOffset={insets.top + SPACING.md}
          />
        }
        alwaysBounceVertical={true}
      >
        <WebContainer>
          <HomeGreetingHeader 
            name={profile?.name ?? STRINGS.common.you} 
            role="player"
            onRoleChange={() => switchToHost()}
            profilePhotoUrl={profile?.avatar_url}
          />
          <HomeStreakCard current={displayWinStreak} />

          <PostMatchInboxSection pendingMatches={pendingMatches} postMatchActions={postMatchActions} marginTopClassName="mt-3" />

          {upcomingMatch ? (
            <View className="mt-4">
              <View className="mb-5">
                <Text className="mb-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.headline }}>
                  {STRINGS.home.sections.upcoming_sub}
                </Text>
                <Text className="text-[24px]" style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, lineHeight: 32 }}>
                  {STRINGS.home.sections.upcoming}
                </Text>
              </View>
              <HeroThemeCard item={upcomingMatch} actionLabel={STRINGS.home.actions.ready} />
            </View>
          ) : null}


          <HomeCarouselSection
            visible={personalizedSessions.length > 0}
            marginTopClassName="mt-10"
            eyebrow={STRINGS.home.sections.personalized_sub}
            title={STRINGS.home.sections.personalized}
            items={personalizedSessions}
            activeIndex={personalizedIndex}
            containerHeight={CAROUSEL_SECTION_HEIGHT}
            onIndexChange={setPersonalizedIndex}
            renderCard={renderPersonalizedCard}
          />

          <HomeCarouselSection
            visible={rescueSessions.length > 0}
            eyebrow={STRINGS.home.sections.rescue_sub}
            title={STRINGS.home.sections.rescue}
            items={rescueSessions}
            activeIndex={rescueIndex}
            containerHeight={CAROUSEL_SECTION_HEIGHT}
            onIndexChange={setRescueIndex}
            renderCard={renderRescueCard}
          />

          <HomeCarouselSection
            visible={familiarCourts.length > 0}
            eyebrow={STRINGS.home.sections.familiar_courts_sub}
            title={STRINGS.home.sections.familiar_courts}
            items={familiarCourts}
            activeIndex={courtIndex}
            containerHeight={COURT_CAROUSEL_HEIGHT}
            onIndexChange={setCourtIndex}
            renderCard={renderCourtCard}
          />
        </WebContainer>
      </ScrollView>

      <ExpandingCreateButton isFAB />
    </View>
  )
}
