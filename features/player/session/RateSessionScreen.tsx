import { AppButton, AppDialog, AppLoading, type AppDialogConfig, SecondaryNavbar } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { getShortSkillLabel, getSkillLevelFromPlayer } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { router, useLocalSearchParams } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  AlertOctagon,
  ArrowDown,
  Check,
  CheckCircle2,
  Clock,
  Heart,
  Hourglass,
  Info,
  MessageCircle,
  ShieldAlert,
  Star,
  Trophy,
  UserX,
  Zap,
} from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {  LayoutAnimation, Platform, ScrollView, Text, TouchableOpacity, UIManager, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {  useSafeAreaInsets } from 'react-native-safe-area-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING } from '@/constants/screenLayout'

type SkillValidation = 'weaker' | 'matched' | 'outclass'

type SessionRecord = {
  id: string
  status: string
  results_status?: string | null
  host_id: string
  session_players: {
    player_id: string
    player?: {
      name?: string | null
      self_assessed_level?: string | null
      skill_label?: string | null
    } | null
  }[]
}

type PlayerInSession = {
  player_id: string
  name: string
  is_host: boolean
  self_assessed_level?: string | null
  skill_label?: string | null
}

type RatingEntry = {
  tags: string[]
  no_show: boolean
  skill_validation: SkillValidation
}

type SkillOption = {
  value: SkillValidation
  label: string
  subtitle: string
  icon: LucideIcon
}

type TagOption = {
  value: string
  label: string
  icon: LucideIcon
  tone: 'positive' | 'warning'
}

const _SW = 2.5

function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const normalized = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean
  const n = Number.parseInt(normalized, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const SKILL_OPTIONS_KEYS = ['weaker', 'matched', 'outclass'] as const
const POSITIVE_TAGS_KEYS = ['fair_play', 'on_time', 'friendly', 'skilled'] as const
const WARNING_TAGS_KEYS = ['toxic', 'late', 'dishonest'] as const

const SKILL_ICONS: Record<string, LucideIcon> = {
  weaker: ArrowDown,
  matched: Check,
  outclass: Trophy,
}

const POSITIVE_ICONS: Record<string, LucideIcon> = {
  fair_play: Heart,
  on_time: Clock,
  friendly: MessageCircle,
  skilled: Zap,
}

const WARNING_ICONS: Record<string, LucideIcon> = {
  toxic: AlertOctagon,
  late: Hourglass,
  dishonest: ShieldAlert,
}

function createDefaultEntry(): RatingEntry {
  return { tags: [], no_show: false, skill_validation: 'matched' }
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

function animateSelection() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
}

function getAvatarLetter(name: string) {
  const first = name.trim().charAt(0)
  return first ? first.toUpperCase() : 'U'
}

function StepProgress({ total, current, theme }: { total: number; current: number; theme: any }) {
  const progress = total > 0 ? (current + 1) / total : 0
  return (
    <View style={{ height: 4, backgroundColor: theme.surfaceContainerHighest, borderRadius: 2, overflow: 'hidden' }}>
      <View 
        style={{ 
          height: '100%', 
          width: `${progress * 100}%`, 
          backgroundColor: theme.primary,
        }} 
      />
    </View>
  )
}

function SectionLabel({ title, subtitle, icon, theme }: { title: string; subtitle?: string; icon?: LucideIcon; theme: any }) {
  const Icon = icon
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={16} color={theme.primary} strokeWidth={2.5} />}
        <Text
          style={{
            fontSize: 22,
            fontFamily: SCREEN_FONTS.headline,
            textTransform: 'uppercase',
            color: theme.primary,
          }}
        >
          {title}
        </Text>
      </View>
      {subtitle ? (
        <Text
          style={{
            marginTop: 2,
            fontSize: 13,
            fontFamily: SCREEN_FONTS.body,
            color: theme.onSurfaceVariant,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  )
}

function SkillChip({
  option,
  active,
  disabled,
  onPress,
  theme,
}: {
  option: SkillOption
  active: boolean
  disabled: boolean
  onPress: () => void
  theme: any
}) {
  const Icon = option.icon

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{
        flex: 1,
        borderRadius: RADIUS.hero,
        padding: SPACING.lg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? theme.primary : theme.surfaceContainerLowest,
        borderWidth: 1.5,
        borderColor: active ? theme.primary : theme.outlineVariant,
        shadowColor: active ? theme.primary : theme.onBackground,
        shadowOpacity: active ? 0.2 : 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: active ? 6 : 2,
        minHeight: 120,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: active ? withAlpha(theme.surface, 0.2) : theme.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: SPACING.md,
        }}
      >
        <Icon size={20} color={active ? theme.surface : theme.onSurfaceVariant} strokeWidth={2.5} />
      </View>
      <Text
        style={{
          fontSize: 15,
          fontFamily: SCREEN_FONTS.headline,
          color: active ? theme.surface : theme.onSurface,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}
      >
        {option.label}
      </Text>
      <Text
        style={{
          fontSize: 10,
          fontFamily: SCREEN_FONTS.body,
          color: active ? withAlpha(theme.surface, 0.8) : theme.outline,
          textAlign: 'center',
          marginTop: 2,
        }}
      >
        {option.subtitle}
      </Text>
    </TouchableOpacity>
  )
}

function TagChip({
  tag,
  active,
  disabled,
  onPress,
  theme,
}: {
  tag: TagOption
  active: boolean
  disabled: boolean
  onPress: () => void
  theme: any
}) {
  const Icon = tag.icon
  const isPositive = tag.tone === 'positive'
  const color = isPositive ? theme.primary : theme.error
  
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 100,
        backgroundColor: active ? color : theme.surfaceContainerLowest,
        borderWidth: 1.5,
        borderColor: active ? color : theme.outlineVariant,
        shadowColor: active ? color : theme.onBackground,
        shadowOpacity: active ? 0.15 : 0.03,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: active ? 4 : 1,
      }}
    >
      <Icon size={16} color={active ? theme.surface : color} strokeWidth={2.5} />
      <Text 
        style={{ 
          fontSize: 14, 
          fontFamily: SCREEN_FONTS.headline, 
          color: active ? theme.surface : theme.onSurface,
          textTransform: 'uppercase'
        }}
      >
        {tag.label}
      </Text>
    </TouchableOpacity>
  )
}

export default function RateSessionScreen() {
  const theme = useAppTheme()
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const [players, setPlayers] = useState<PlayerInSession[]>([])
  const [ratings, setRatings] = useState<Record<string, RatingEntry>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  const currentPlayer = players[currentIndex] ?? null
  const currentEntry = currentPlayer ? (ratings[currentPlayer.player_id] ?? createDefaultEntry()) : createDefaultEntry()

  const SKILL_OPTIONS = useMemo<SkillOption[]>(() => SKILL_OPTIONS_KEYS.map(key => ({
    value: key,
    label: t(`rate_session_screen.skill_options.${key}`),
    subtitle: t(`rate_session_screen.skill_options.${key}_sub`),
    icon: SKILL_ICONS[key]
  })), [t])

  const POSITIVE_TAGS = useMemo<TagOption[]>(() => POSITIVE_TAGS_KEYS.map(key => ({
    value: key,
    label: t(`rate_session_screen.positive_tags.${key}`),
    icon: POSITIVE_ICONS[key],
    tone: 'positive'
  })), [t])

  const WARNING_TAGS = useMemo<TagOption[]>(() => WARNING_TAGS_KEYS.map(key => ({
    value: key,
    label: t(`rate_session_screen.warning_tags.${key}`),
    icon: WARNING_ICONS[key],
    tone: 'warning'
  })), [t])

  const init = useCallback(async () => {
    if (!id) return

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/login' as any)
      return
    }
    setMyId(user.id)

    // Fetch session and existing ratings in parallel
    const [sessionRes, ratingsRes] = await Promise.all([
      supabase
        .from('sessions')
        .select(`
          id, status, results_status, host_id,
          session_players (
            player_id,
            player:player_id ( name, self_assessed_level, skill_label )
          )
        `)
        .eq('id', id)
        .single(),
      supabase
        .from('ratings')
        .select('rated_id')
        .eq('session_id', id)
        .eq('rater_id', user.id)
    ])

    const { data: session, error: sessionError } = sessionRes
    const { data: existingRatings } = ratingsRes

    if (sessionError || !session) {
      setLoading(false)
      setDialogConfig({
        title: t('rate_session_screen.err_not_found'),
        message: sessionError?.message ?? t('rate_session_screen.err_not_found_desc'),
        actions: [{ label: t('rate_session_screen.btn_got_it') }],
      })
      return
    }

    const isSessionEnded = session.status === 'done' || session.status === 'pending_completion' || session.results_status === 'finalized'

    if (!isSessionEnded) {
      setLoading(false)
      setDialogConfig({
        title: t('rate_session_screen.err_not_ended'),
        message: t('rate_session_screen.err_not_ended_desc'),
        actions: [{ label: t('rate_session_screen.btn_go_back'), onPress: () => router.back() }],
      })
      return
    }

    if (session.results_status !== 'finalized') {
      setLoading(false)
      setDialogConfig({
        title: t('rate_session_screen.err_not_finalized'),
        message: t('rate_session_screen.err_not_finalized_desc'),
        actions: [{ label: t('rate_session_screen.btn_go_back'), onPress: () => router.back() }],
      })
      return
    }

    const typedSession = session as unknown as SessionRecord
    const ratedIds = new Set((existingRatings ?? []).map((item: any) => item.rated_id))
    
    const unratedPlayers = typedSession.session_players
      .filter((item) => item.player_id !== user.id)
      .filter((item) => !ratedIds.has(item.player_id))
      .map((item) => ({
        player_id: item.player_id,
        name: item.player?.name?.trim() || t('rate_session_screen.default_player'),
        is_host: item.player_id === typedSession.host_id,
        self_assessed_level: item.player?.self_assessed_level ?? null,
        skill_label: item.player?.skill_label ?? null,
      }))

    if ((existingRatings?.length ?? 0) > 0 && unratedPlayers.length === 0) {
      setAlreadyRated(true)
      setLoading(false)
      return
    }

    setPlayers(unratedPlayers)
    const initialRatings: Record<string, RatingEntry> = {}
    unratedPlayers.forEach((player) => {
      initialRatings[player.player_id] = createDefaultEntry()
    })
    setRatings(initialRatings)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void init()
  }, [init])

  function toggleTag(playerId: string, tag: string) {
    animateSelection()
    setRatings((prev) => {
      const current = prev[playerId] ?? createDefaultEntry()
      const nextTags = current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag]
      return { ...prev, [playerId]: { ...current, tags: nextTags } }
    })
  }

  function toggleNoShow(playerId: string) {
    animateSelection()
    setRatings((prev) => {
      const current = prev[playerId] ?? createDefaultEntry()
      const nextNoShow = !current.no_show
      return {
        ...prev,
        [playerId]: {
          ...current,
          no_show: nextNoShow,
          tags: nextNoShow ? [] : current.tags,
          skill_validation: nextNoShow ? 'matched' : current.skill_validation,
        },
      }
    })
  }

  function setSkillValidation(playerId: string, value: SkillValidation) {
    animateSelection()
    setRatings((prev) => ({
      ...prev,
      [playerId]: {
        ...(prev[playerId] ?? createDefaultEntry()),
        skill_validation: value,
      },
    }))
  }

  async function submit(entryOverride?: RatingEntry) {
    if (!myId || !id || !currentPlayer) return

    setSaving(true)
    const entry = entryOverride ?? ratings[currentPlayer.player_id] ?? createDefaultEntry()

    const { error: ratingError } = await supabase.rpc('submit_rating', {
      p_session_id: id,
      p_rated_id: currentPlayer.player_id,
      p_tags: entry.no_show ? [] : entry.tags,
      p_no_show: entry.no_show,
      p_skill_validation: entry.no_show ? 'matched' : entry.skill_validation,
    })

    if (ratingError) {
      setSaving(false)
      setDialogConfig({
        title: t('rate_session_screen.err_submit'),
        message: ratingError.message,
        actions: [{ label: t('rate_session_screen.btn_got_it') }],
      })
      return
    }

    const { error: processError } = await supabase.rpc('process_final_ratings', { p_session_id: id })
    if (processError) {
      setSaving(false)
      setDialogConfig({
        title: t('rate_session_screen.err_process'),
        message: processError.message,
        actions: [{ label: t('rate_session_screen.btn_got_it') }],
      })
      return
    }

    const nextCompleted = completedCount + 1
    const hasNext = currentIndex < players.length - 1
    if (hasNext) {
      setCompletedCount(nextCompleted)
      setCurrentIndex((prev) => prev + 1)
      setSaving(false)
      return
    }

    setSaving(false)
    setDialogConfig({
      title: t('rate_session_screen.success_title'),
      message: t('rate_session_screen.success_desc'),
      actions: [{ label: t('rate_session_screen.btn_home'), onPress: () => router.replace('/player-hub/my-sessions' as any) }],
    })
  }

  function handleSkip() {
    if (saving) return
    void submit(createDefaultEntry())
  }

  if (loading) {
    return <AppLoading fullScreen />
  }

  if (alreadyRated || !currentPlayer) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 40 }}>
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <View 
              style={{ 
                width: 80, 
                height: 80, 
                borderRadius: 40, 
                backgroundColor: theme.primary,
                alignItems: 'center', 
                justifyContent: 'center',
                shadowColor: theme.primary,
                shadowOpacity: 0.3,
                shadowRadius: 15,
                shadowOffset: { width: 0, height: 8 }
              }}
            >
              <CheckCircle2 size={40} color={theme.onPrimary} strokeWidth={2} />
            </View>
          </View>
          <Text style={{ fontSize: 24, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, textAlign: 'center' }}>
            {alreadyRated ? t('rate_session_screen.completed_title') : t('rate_session_screen.great_title')}
          </Text>
          <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, textAlign: 'center', marginTop: 12, lineHeight: 22 }}>
            {alreadyRated 
              ? t('rate_session_screen.already_rated_desc')
              : t('rate_session_screen.completed_desc')}
          </Text>
          <View style={{ marginTop: 40 }}>
            <AppButton label={t('rate_session_screen.btn_home')} onPress={() => router.replace('/player-hub/my-sessions' as any)} variant="primary" />
          </View>
        </View>
        <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
      </View>
    )
  }

  const fullSkillLabel = getShortSkillLabel(getSkillLevelFromPlayer(currentPlayer))
  const skillLabel = fullSkillLabel.replace(/^Trình\s+/i, '')

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StepProgress total={players.length} current={currentIndex} theme={theme} />
      
      <SecondaryNavbar
        onBackPress={() => router.back()}
        title={t('rate_session_screen.title_review')}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Hero Section */}
        <LinearGradient
          colors={[withAlpha(theme.primary, 0.05), 'transparent']}
          style={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, alignItems: 'center' }}
        >
          <View style={{ position: 'relative' }}>
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: theme.surfaceContainerHighest,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 4,
                borderColor: theme.surface,
                shadowColor: theme.onBackground,
                shadowOpacity: 0.1,
                shadowRadius: 15,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }}
            >
              <Text style={{ fontSize: 36, fontFamily: SCREEN_FONTS.headline, color: theme.primary }}>
                {getAvatarLetter(currentPlayer.name)}
              </Text>
            </View>
            {currentPlayer.is_host && (
              <View 
                style={{ 
                  position: 'absolute', 
                  bottom: 0, 
                  right: 0, 
                  backgroundColor: theme.primary,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: RADIUS.md,
                  borderWidth: 2,
                  borderColor: theme.surface
                }}
              >
                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: theme.surface }}>{t('rate_session_screen.host_badge')}</Text>
              </View>
            )}
          </View>

          <Text style={{ marginTop: 20, fontSize: 26, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, textTransform: 'uppercase' }}>
            {currentPlayer.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <View style={{ backgroundColor: theme.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 }}>
              <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.label, color: theme.outline }}>
                {skillLabel}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 24, gap: 32 }}>
          {/* Skill Validation */}
          <View>
            <SectionLabel title={t('rate_session_screen.skill_title')} subtitle={t('rate_session_screen.skill_subtitle')} icon={Trophy} theme={theme} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {SKILL_OPTIONS.map((option) => (
                <SkillChip
                  key={option.value}
                  option={option}
                  active={currentEntry.skill_validation === option.value}
                  disabled={currentEntry.no_show}
                  onPress={() => setSkillValidation(currentPlayer.player_id, option.value)}
                  theme={theme}
                />
              ))}
            </View>
          </View>

          {/* Tags Section */}
          <View>
            <SectionLabel title={t('rate_session_screen.tag_title')} subtitle={t('rate_session_screen.tag_subtitle')} icon={Star} theme={theme} />
            
            <View style={{ gap: 24 }}>
              {/* Compliments */}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Heart size={14} color={theme.primary} strokeWidth={2.5} />
                  <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.outline, letterSpacing: 1 }}>{t('rate_session_screen.compliments')}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {POSITIVE_TAGS.map((tag) => (
                    <TagChip
                      key={tag.value}
                      tag={tag}
                      active={currentEntry.tags.includes(tag.value)}
                      disabled={currentEntry.no_show}
                      onPress={() => toggleTag(currentPlayer.player_id, tag.value)}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>

              {/* Warnings */}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <ShieldAlert size={14} color={theme.error} strokeWidth={2.5} />
                  <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.outline, letterSpacing: 1 }}>{t('rate_session_screen.warnings')}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {WARNING_TAGS.map((tag) => (
                    <TagChip
                      key={tag.value}
                      tag={tag}
                      active={currentEntry.tags.includes(tag.value)}
                      disabled={currentEntry.no_show}
                      onPress={() => toggleTag(currentPlayer.player_id, tag.value)}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* No Show Section */}
          <TouchableOpacity
            onPress={() => toggleNoShow(currentPlayer.player_id)}
            activeOpacity={0.8}
            style={{
              marginTop: 12,
              padding: 20,
              borderRadius: 24,
              backgroundColor: currentEntry.no_show ? withAlpha(theme.error, 0.08) : theme.surfaceContainerLowest,
              borderWidth: 2,
              borderColor: currentEntry.no_show ? theme.error : theme.outlineVariant,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 16,
              shadowColor: '#000',
              shadowOpacity: 0.03,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 2,
            }}
          >
            <View 
              style={{ 
                width: 48, 
                height: 48, 
                borderRadius: 24, 
                backgroundColor: currentEntry.no_show ? theme.error : theme.surfaceContainerHigh,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <UserX size={24} color={currentEntry.no_show ? theme.surface : theme.outline} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontFamily: SCREEN_FONTS.headline, color: currentEntry.no_show ? theme.error : theme.onSurface, textTransform: 'uppercase' }}>
                {t('rate_session_screen.no_show_title')}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, marginTop: 2 }}>
                {t('rate_session_screen.no_show_desc')}
              </Text>
            </View>
            <View 
              style={{ 
                width: 24, 
                height: 24, 
                borderRadius: 12, 
                borderWidth: 2, 
                borderColor: currentEntry.no_show ? theme.error : theme.outlineVariant,
                backgroundColor: currentEntry.no_show ? theme.error : 'transparent',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {currentEntry.no_show && <Check size={14} color={theme.surface} strokeWidth={3} />}
            </View>
          </TouchableOpacity>
          
          <View
            style={{
              padding: 16,
              borderRadius: RADIUS.lg,
              backgroundColor: theme.surfaceContainerLow,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <Info size={16} color={theme.primary} strokeWidth={2.5} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, lineHeight: 18 }}>
              {t('rate_session_screen.info_text')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Floating Footer */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 24,
          paddingTop: 16,
          paddingBottom: insets.bottom + 20,
          backgroundColor: withAlpha(theme.surface, 0.95),
          borderTopWidth: 1,
          borderTopColor: theme.outlineVariant,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AppButton
              label={currentIndex === players.length - 1 ? t('rate_session_screen.btn_finish') : t('rate_session_screen.btn_next')}
              onPress={() => void submit()}
              loading={saving}
              variant="primary"
            />
          </View>
          <TouchableOpacity
            onPress={handleSkip}
            style={{
              paddingHorizontal: 20,
              justifyContent: 'center',
              borderRadius: RADIUS.full,
              backgroundColor: theme.surfaceContainerHigh,
            }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.cta, fontSize: 15, color: theme.onSurface }}>
              {t('rate_session_screen.btn_skip')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </View>
  )
}
