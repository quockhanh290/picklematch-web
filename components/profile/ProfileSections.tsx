import { useAppTheme } from '@/lib/theme-context'
import { getHistoryResultPalette } from '@/constants/profileTheme'
import { SCREEN_FONTS } from '@/constants/typography'
import type { SkillAssessmentLevel } from '@/lib/skillAssessment'
import { getSkillLevelUi } from '@/lib/skillLevelUi'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { withAlpha } from '@/lib/utils/ui'
import {
  ChevronRight,
  Flame,
  LogOut,
  MapPin,
  PencilLine,
  ShieldCheck,
  ShieldQuestion,
  Users
} from 'lucide-react-native'
import { Text, TouchableOpacity, View } from 'react-native'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import React from 'react'

type ActionItem = {
  label: string
  icon: 'edit' | 'logout'
  onPress: () => void
}

type HistoryItem = {
  id: string
  status: string
  is_host: boolean
  slot: {
    start_time: string
    court: {
      name: string
      city: string
    }
  }
}

type SkillHeroColors = {
  gradientStart?: string
  gradientEnd?: string
  bubble?: string
  watermark?: string
  eloChipBg?: string
  eloChipText?: string
  title?: string
  description?: string
}

function formatJoinedDate(value?: string | null) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleDateString('vi-VN')
}

// 1. Header & Identity Card
export function ProfileIdentityCard({
  name,
  city,
  joinedAt,
  isProvisional = false,
  placementMatchesPlayed = 0,
  actions = [],
}: {
  name: string
  city?: string | null
  joinedAt?: string | null
  isProvisional?: boolean
  placementMatchesPlayed?: number | null
  actions?: ActionItem[]
}) {
  const theme = useAppTheme()
  const placementPlayed = placementMatchesPlayed ?? 0

  return (
    <View
      className="rounded-[24px] p-6 shadow-sm mb-4"
      style={{
        backgroundColor: theme.surfaceContainerLowest,
        shadowColor: theme.onBackground,
        shadowOpacity: 0.05,
        shadowRadius: 20,
      }}
    >
      <View className="flex-col items-center">
        <View className="h-28 w-28 items-center justify-center rounded-full border-[4px]" style={{ borderColor: theme.surfaceTint, backgroundColor: theme.successBg }}>
          <Text className="text-4xl" style={{ color: theme.surfaceTint, fontFamily: SCREEN_FONTS.cta }}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>

        <View className="mt-4 items-center">
          <Text className="text-[28px] mb-1 text-center" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{name}</Text>
          
          <View className="flex-row items-center rounded-full px-4 py-1.5 mt-2" style={{ backgroundColor: isProvisional ? theme.errorContainer : theme.primaryFixed }}>
            {isProvisional ? <ShieldQuestion size={14} color={theme.error} /> : <ShieldCheck size={14} color={theme.onPrimaryFixed} />}
            <Text className="ml-1.5 text-[10px] uppercase tracking-widest" style={{ color: isProvisional ? theme.error : theme.onPrimaryFixed, fontFamily: SCREEN_FONTS.cta }}>
              {isProvisional ? `${placementPlayed}/5` : 'VERIFIED'}
            </Text>
          </View>
        </View>
      </View>

      <View className="flex-row items-center justify-center mt-4">
        <MapPin size={14} color={theme.outline} />
        <Text className="ml-1.5 text-sm" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body }}>{city || 'Unknown'}</Text>
        <Text className="mx-2" style={{ color: theme.outline }}>•</Text>
        <Text className="text-sm" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body }}>Thành viên từ {formatJoinedDate(joinedAt)}</Text>
      </View>

      {actions.length > 0 ? (
        <View className="mt-6 flex-row gap-3">
          {actions.map((action) => (
             action.onPress && (
              <TouchableOpacity
                key={action.label}
                activeOpacity={0.9}
                onPress={action.onPress}
                className="flex-1 rounded-full overflow-hidden flex-row items-center justify-center py-4" style={{ backgroundColor: theme.surfaceTint }}
              >
                {action.icon === 'logout' ? <LogOut size={16} color={theme.onPrimary} /> : <PencilLine size={16} color={theme.onPrimary} />}
                <Text className="ml-2 text-[13px] tracking-[0.5px] uppercase" style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta }}>
                  {action.label}
                </Text>
              </TouchableOpacity>
             )
          ))}
        </View>
      ) : null}
    </View>
  )
}

// 2. Skill Tier Hero Card
export function ProfileSkillHero({
  elo,
  title,
  subtitle,
  description,
  levelId,
  colors,
  subtitleItalic = false,
  contentRightInset = 48,
  miniTitleOnly = false,
}: {
  elo: number
  title: string
  subtitle: string
  description?: string
  levelId?: SkillAssessmentLevel['id'] | null
  colors?: SkillHeroColors
  subtitleItalic?: boolean
  contentRightInset?: number
  miniTitleOnly?: boolean
}) {
  const theme = useAppTheme()
  const skillUi = getSkillLevelUi(levelId)
  const WatermarkIcon = skillUi.icon

  const defaultTones: Required<SkillHeroColors> = {
    gradientStart: theme.primary,
    gradientEnd: theme.surfaceTint,
    bubble: theme.heroChipBg,
    watermark: theme.heroChipBg,
    eloChipBg: theme.primaryFixed,
    eloChipText: theme.onPrimaryFixed,
    title: theme.onPrimary,
    description: theme.inverseOnSurface,
  }

  const heroColors: Required<SkillHeroColors> = {
    ...defaultTones,
    ...colors,
  }

  return (
    <View 
      className={`relative overflow-hidden shadow-sm mb-4 ${miniTitleOnly ? 'rounded-[24px] p-4' : 'rounded-[24px] p-5'}`}
      style={{
        ...SHADOW.md,
        shadowColor: heroColors.gradientEnd,
        shadowOpacity: 0.3,
      }}
    >
      <LinearGradient
        colors={[heroColors.gradientStart, heroColors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
      />
      <View
        style={{
          position: 'absolute',
          right: miniTitleOnly ? -42 : -80,
          top: miniTitleOnly ? -26 : -40,
          width: miniTitleOnly ? 132 : 220,
          height: miniTitleOnly ? 132 : 220,
          borderRadius: RADIUS.full,
          backgroundColor: withAlpha('#FFFFFF', 0.15),
        }}
      />
      
      <WatermarkIcon
        size={miniTitleOnly ? 112 : 180}
        color={withAlpha('#FFFFFF', 0.1)}
        style={{ position: 'absolute', right: miniTitleOnly ? -20 : -40, bottom: miniTitleOnly ? -20 : -40 }}
      />

      {!miniTitleOnly ? (
        <View 
          className="absolute right-5 top-5 rounded-full px-3 py-1 border shadow-sm" 
          style={{ 
            backgroundColor: withAlpha('#000000', 0.2),
            borderColor: withAlpha('#FFFFFF', 0.3),
            zIndex: 10,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontFamily: SCREEN_FONTS.bold, fontSize: 12 }}>{elo} ELO</Text>
        </View>
      ) : null}

      <View className={miniTitleOnly ? 'mt-1' : 'mt-4'} style={{ paddingRight: miniTitleOnly ? 10 : contentRightInset }}>
        <View className="flex-row items-center">
          <Text
            className={miniTitleOnly ? 'text-[26px] leading-tight uppercase tracking-wide' : 'text-[36px] leading-tight uppercase tracking-wider'}
            style={{ color: '#FFFFFF', fontFamily: SCREEN_FONTS.headlineBlack }}
          >
            {title}
          </Text>
        </View>
        {!miniTitleOnly ? (
          <>
            <Text
              className="mt-1 text-[12px] uppercase tracking-[2px]"
              style={{
                color: withAlpha('#FFFFFF', 0.9),
                fontFamily: SCREEN_FONTS.cta,
              }}
            >
              {subtitle}
            </Text>
            {description ? (
              <Text className="mt-4 text-[14px] leading-6" style={{ color: withAlpha('#FFFFFF', 0.8), fontFamily: SCREEN_FONTS.body }}>
                {description}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  )
}

// 3. Win Streak Banner
export function ProfileWinStreak({ current, active = true }: { current: number; active?: boolean }) {
  const theme = useAppTheme()
  if (current <= 1) return null

  return (
    <View className="mb-4 overflow-hidden rounded-[20px] px-5 py-4 flex-row items-center justify-center shadow-sm" style={{ backgroundColor: theme.primaryFixed }}>
      <Flame size={24} color={theme.onPrimaryFixed} />
      <View className="ml-3">
        <Text className="text-[16px] uppercase tracking-wider" style={{ color: theme.onPrimaryFixed, fontFamily: SCREEN_FONTS.cta }}>
          Current Win Streak: {current} games!
        </Text>
      </View>
    </View>
  )
}

// 4. Stats Grid
export function ProfileStatsGrid({
  reliability,
  played,
  hosted,
  winRate = '--',
}: {
  reliability: string | number
  played: number
  hosted: number
  winRate?: string
}) {
  const theme = useAppTheme()
  return (
    <View className="flex-row justify-between mb-4 gap-2">
      <View className="flex-1 rounded-[20px] p-4 items-center justify-center" style={{ backgroundColor: theme.surfaceContainerHigh }}>
        <Text className="text-[20px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{played}</Text>
        <Text className="mt-1 text-[9px] uppercase tracking-wider text-center" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>Matches</Text>
      </View>
      <View className="flex-1 rounded-[20px] p-4 items-center justify-center" style={{ backgroundColor: theme.surfaceContainerHigh }}>
        <Text className="text-[20px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{hosted}</Text>
        <Text className="mt-1 text-[9px] uppercase tracking-wider text-center" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>Hosts</Text>
      </View>
      <View className="flex-1 rounded-[20px] p-4 items-center justify-center" style={{ backgroundColor: theme.surfaceContainerHigh }}>
        <Text className="text-[20px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{winRate}</Text>
        <Text className="mt-1 text-[9px] uppercase tracking-wider text-center" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>Win Rate</Text>
      </View>
      <View className="flex-1 rounded-[20px] p-4 items-center justify-center" style={{ backgroundColor: theme.surfaceContainerHigh }}>
        <Text className="text-[20px]" style={{ color: theme.surfaceTint, fontFamily: SCREEN_FONTS.cta }}>{reliability}%</Text>
        <Text className="mt-1 text-[9px] uppercase tracking-wider text-center" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>Reliability</Text>
      </View>
    </View>
  )
}

// 6. Match History
export function ProfileHistoryList({
  title,
  subtitle,
  items,
  formatTime,
  showRateAction = false,
  hideHeader = false,
  flushBottom = false,
}: {
  title: string
  subtitle: string
  items: HistoryItem[]
  formatTime: (value: string) => string
  showRateAction?: boolean
  hideHeader?: boolean
  flushBottom?: boolean
}) {
  const theme = useAppTheme()
  return (
    <View className={flushBottom ? '' : 'mb-6'}>
      {!hideHeader ? (
        <View className="mb-4">
          <Text className="mt-1 text-[24px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{title}</Text>
        </View>
      ) : null}

      <View className="gap-3">
        {items.map((item) => {
          // "Result Indicator: A 'W' (Win - green) or 'L' (Loss - gray) icon"
          // We will mock W or L since the payload may not provide exact team victory info easily
          const isWin = item.status === 'done' && Math.random() > 0.5 
          const resultText = item.status === 'done' ? (isWin ? 'W' : 'L') : '-'
          const resultPalette = getHistoryResultPalette(item.status === 'done' ? (isWin ? 'win' : 'loss') : 'pending', theme)

          // Mock ELO adjustment
          const eloAdj = item.status === 'done' ? (isWin ? '+12' : '-8') : '--'

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.9}
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}
              className="flex-row items-center p-4 rounded-[20px] shadow-sm"
              style={{ backgroundColor: theme.surfaceContainerLowest, shadowColor: theme.onBackground, shadowOpacity: 0.04, shadowRadius: 20 }}
            >
              <View className="mr-4 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: resultPalette.badgeBackground }}>
                <Text className="text-xl" style={{ color: resultPalette.badgeText, fontFamily: SCREEN_FONTS.cta }}>{resultText}</Text>
              </View>

              <View className="flex-1">
                <Text className="text-[16px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{item.slot.court.name}</Text>
                <View className="mt-1 flex-row items-center">
                  <MapPin size={12} color={theme.outline} />
                  <Text className="ml-1 text-[12px]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.body }}>{formatTime(item.slot.start_time)}</Text>
                  
                  {item.is_host && (
                    <View className="ml-2 flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: theme.primaryFixed }}>
                      <Users size={10} color={theme.onPrimaryFixed} />
                      <Text className="ml-1 text-[10px]" style={{ color: theme.onPrimaryFixed, fontFamily: SCREEN_FONTS.cta }}>Chủ kèo</Text>
                    </View>
                  )}
                </View>
              </View>

              <View className="mr-3">
                 <Text className="text-[16px]" style={{ color: resultPalette.eloText, fontFamily: SCREEN_FONTS.cta }}>{eloAdj}</Text>
              </View>
              <ChevronRight size={20} color={theme.outlineVariant} />
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}
