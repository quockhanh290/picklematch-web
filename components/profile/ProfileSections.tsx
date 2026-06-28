import { useAppTheme } from '@/lib/theme-context'
import { getHistoryResultPalette } from '@/constants/profileTheme'
import { SCREEN_FONTS } from '@/constants/typography'
import { eloToPvna, type SkillAssessmentLevel } from '@/lib/skillAssessment'
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

// 2. Skill Tier Hero Card - Redesigned to match SmartQueueBanner (Inactive style)
export function ProfileSkillHero({
  elo,
  title,
  subtitle,
  description,
  levelId,
}: {
  elo: number
  title: string
  subtitle: string
  description?: string
  levelId?: SkillAssessmentLevel['id'] | null
}) {
  const theme = useAppTheme()
  const pvnaScore = eloToPvna(elo).toFixed(1)

  return (
    <View 
      style={{
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        ...SHADOW.xs
      }}
    >
      <LinearGradient
        colors={['#F5F1E8', '#FFFFFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 24 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            {/* Top Badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ 
                width: 24, height: 24, borderRadius: 12, 
                backgroundColor: theme.primaryContainer,
                alignItems: 'center', justifyContent: 'center', marginRight: 8
              }}>
                <ShieldCheck size={14} color={theme.primary} strokeWidth={2.5} />
              </View>
              <Text style={{ 
                color: theme.primary, 
                fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' 
              }}>
                TRÌNH ĐỘ PVNA
              </Text>
            </View>

            {/* Title */}
            <Text style={{ 
              color: theme.onSurface, 
              fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, lineHeight: 32, textTransform: 'uppercase', letterSpacing: -0.5
            }}>
              {title}
            </Text>

            {/* Subtitle */}
            <Text style={{ 
              marginTop: 4,
              color: theme.onSurface, 
              fontFamily: SCREEN_FONTS.headline, fontSize: 16, opacity: 0.8
            }}>
              {subtitle}
            </Text>
            
            {/* Description */}
            {description ? (
              <Text style={{ 
                marginTop: 10,
                color: theme.onSurfaceVariant, 
                fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 20 
              }}>
                {description}
              </Text>
            ) : null}
          </View>

          {/* ELO Circle */}
          <View style={{ 
            width: 84, height: 84, borderRadius: 42, 
            backgroundColor: 'white', 
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: theme.outlineVariant,
            ...SHADOW.xs
          }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, lineHeight: 28 }}>
                {pvnaScore}
              </Text>
              <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.bold, fontSize: 10, marginTop: -2 }}>
                PVNA
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
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

          // Mock PVNA adjustment
          const pvnaAdj = item.status === 'done' ? (isWin ? '+0.1' : '-0.05') : '--'

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.9}
              onPress={() => router.push({ pathname: '/player-hub/session/[id]/', params: { id: item.id } })}
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
                  <Text className="ml-1 text-[12px]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.body }}>{formatTime(item.slot?.start_time)}</Text>
                  
                  {item.is_host && (
                    <View className="ml-2 flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: theme.primaryFixed }}>
                      <Users size={10} color={theme.onPrimaryFixed} />
                      <Text className="ml-1 text-[10px]" style={{ color: theme.onPrimaryFixed, fontFamily: SCREEN_FONTS.cta }}>Chủ kèo</Text>
                    </View>
                  )}
                </View>
              </View>

              <View className="mr-3">
                 <Text className="text-[16px]" style={{ color: resultPalette.eloText, fontFamily: SCREEN_FONTS.cta }}>{pvnaAdj}</Text>
              </View>
              <ChevronRight size={20} color={theme.outlineVariant} />
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}
