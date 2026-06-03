import React, { useState } from 'react'
import { Text, View, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react-native'
import { type ArrangementPlayer } from '@/lib/sessionDetail'
import { STRINGS } from '@/constants/strings'
import { supabase } from '@/lib/supabase'
import { BrandedFooter } from '@/components/design/BrandedFooter'
import { arrangeFixedTeams } from '@/lib/scheduler/fixedTeamPairing'
import { buildFixedTeamScheduleDraft, type FixedTeamScheduledMatch } from '@/lib/scheduler/fixedTeamSchedule'
import { hasCompleteFixedPair, type FixedTeamOptimizationProfile } from '@/lib/scheduler/scoring'
import { optimizeSocialPlan } from '@/lib/scheduler/socialOptimizer'
import { optimizeRotationPlan } from '@/lib/scheduler/rotationOptimizer'
import { useAppTheme } from '@/lib/theme-context'
import { useTranslation } from 'react-i18next'
import { ScheduleCoverageReport } from './ScheduleCoverageReport'

type Props = {
  onClose: () => void
  players: ArrangementPlayer[]
  maxPlayers: number
  courtCount?: number
  sessionId: string
  onUpdated: () => void
  onGoToMatches?: () => void
  onApplySchedule?: (payload: {
    matches: FixedTeamScheduledMatch[]
    players: ArrangementPlayer[]
    quality: { runtimeMs: number, timedOut: boolean, fallbackUsed: boolean }
    mode: 'full' | 'limited'
    minGames: number
  }) => void
  isAfterEnd?: boolean
}

export function TeamArrangementScreen({ onClose, players, maxPlayers, courtCount = 1, sessionId, onUpdated, onGoToMatches, onApplySchedule, isAfterEnd }: Props) {
  const theme = useAppTheme()
  const { t } = useTranslation()
  const maxTeamCount = Math.max(1, Math.floor(players.length / 2))
  const defaultTeamCount = Math.max(1, Math.min(maxTeamCount, Math.ceil(players.length / 2)))
  const [arrangedPlayers, setArrangedPlayers] = useState<ArrangementPlayer[]>(players)
  const [submitting, setSubmitting] = useState(false)
  const [targetNumTeams, setTargetNumTeams] = useState(defaultTeamCount)
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)
  const [hasOngoingMatches, setHasOngoingMatches] = useState(false)
  const [, setCheckingMatches] = useState(false)
  const [optimizationProfile, setOptimizationProfile] = useState<FixedTeamOptimizationProfile | 'social'>('social')
  const [targetGamesPerTeam, setTargetGamesPerTeam] = useState(4)
  const [tempCourtCount, setTempCourtCount] = useState(courtCount)
  const [showDetailedSchedule, setShowDetailedSchedule] = useState(false)
  const [socialSubMode, setSocialSubMode] = useState<'fixed' | 'rotation'>('fixed')
  const [previewExpanded, setPreviewExpanded] = useState(true)
  const [distributionExpanded, setDistributionExpanded] = useState(true)
  const [rebalanceTick, setRebalanceTick] = useState(0)

  // Sync state when players change or mount
  React.useEffect(() => {
    const checkOngoing = async () => {
      setCheckingMatches(true)
      try {
        const { count, error } = await supabase
          .from('session_matches')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', sessionId)
          .eq('status', 'playing')
        
        if (!error) {
          setHasOngoingMatches((count || 0) > 0)
        }
      } catch (e) {
        console.error('Error checking ongoing matches:', e)
      } finally {
        setCheckingMatches(false)
      }
    }

    setArrangedPlayers(hasCompleteFixedPair(players)
      ? players
      : arrangeFixedTeams(players, defaultTeamCount, {
        profile: optimizationProfile === 'social' ? 'balanced' : optimizationProfile,
        preserveExistingPairs: false,
      }))
    setTargetNumTeams(defaultTeamCount)
    checkOngoing()
  }, [defaultTeamCount, optimizationProfile, players, sessionId])

  const teamOptions = Array.from({ length: targetNumTeams }, (_, i) => i + 1)

  const draftSchedule = React.useMemo(
    () => {
      if (optimizationProfile === 'social') {
        if (socialSubMode === 'rotation') {
          const result = optimizeRotationPlan(arrangedPlayers, {
            targetGamesPerPlayer: targetGamesPerTeam,
            courtCount: tempCourtCount,
            iterations: 20000
          })
          return {
            matches: result.matches,
            players: result.players,
            quality: result.quality
          }
        } else {
          const result = optimizeSocialPlan(arrangedPlayers, {
            targetGamesPerTeam,
            courtCount: tempCourtCount,
            iterations: 20000
          })
          return {
            matches: result.matches,
            players: result.players,
            quality: {
              runtimeMs: result.quality.runtimeMs,
              timedOut: false,
              fallbackUsed: false,
              pairingScore: result.quality.score,
              overallScore: result.quality.overallScore
            }
          }
        }
      }
      return buildFixedTeamScheduleDraft(arrangedPlayers, courtCount, optimizationProfile as FixedTeamOptimizationProfile)
    },
    [arrangedPlayers, courtCount, optimizationProfile, rebalanceTick, socialSubMode, targetGamesPerTeam, tempCourtCount]
  )

  const handleOptimizationProfileChange = (profile: FixedTeamOptimizationProfile | 'social') => {
    setOptimizationProfile(profile)
    if (isAfterEnd) return
    if (profile !== 'social') {
      setArrangedPlayers(current => arrangeFixedTeams(current, targetNumTeams, { profile: profile as FixedTeamOptimizationProfile, preserveExistingPairs: false }))
    } else {
      // Social mode will auto-optimize in useMemo, but we can trigger a re-pairing here if needed
      setArrangedPlayers(current => arrangeFixedTeams(current, targetNumTeams, { profile: 'balanced', preserveExistingPairs: false }))
    }
  }

  const displayPlayers = optimizationProfile === 'social' ? draftSchedule.players : arrangedPlayers
  const isFixedPairSocial = optimizationProfile === 'social' && socialSubMode === 'fixed'
  const fixedPairWaitingPlayers = isFixedPairSocial
    ? arrangedPlayers.filter(player => player.team <= 0)
    : []
  const hasFixedPairWaitingPlayers = fixedPairWaitingPlayers.length > 0
  const fixedPairWaitingNames = fixedPairWaitingPlayers.map(player => player.name).join(', ')

  const handleSave = async () => {
    if (isAfterEnd) return
    const invalidTeams = teamOptions
      .map(teamNo => ({ teamNo, count: getTeamPlayers(teamNo).length }))
      .filter(team => team.count !== 2)
    if (invalidTeams.length > 0) {
      Alert.alert(
        STRINGS.host_flow.team_arrangement.not_enough_players,
        STRINGS.host_flow.team_arrangement.invalid_team_count.replace(
          '{info}',
          invalidTeams.map(team => `Đội ${team.teamNo} (${team.count})`).join(', ')
        )
      )
      return
    }

    if (hasOngoingMatches) {
      const confirm = await new Promise((resolve) => {
        Alert.alert(
          '⚠️ Cảnh báo trận đấu',
          'Hiện đang có trận đấu đang diễn ra. Thay đổi đội hình lúc này có thể làm sai lệch thông tin trận đấu. Bạn vẫn muốn lưu chứ?',
          [
            { text: 'HỦY', style: 'cancel', onPress: () => resolve(false) },
            { text: 'VẪN LƯU', style: 'destructive', onPress: () => resolve(true) }
          ]
        )
      })
      if (!confirm) return
    }

    setSubmitting(true)
    try {
      const playersToSave = optimizationProfile === 'social' ? draftSchedule.players : arrangedPlayers
      const assignments = playersToSave
        .filter(p => p.team > 0)
        .map(p => ({
          player_id: p.id,
          team_no: p.team
        }))

      const { error: saveError } = await supabase.rpc('save_session_teams', {
        p_session_id: sessionId,
        p_assignments: assignments
      })
      
      if (saveError) {
        throw saveError
      }

      onUpdated()
      onClose()
    } catch (error: any) {
      console.error('[TeamArrangement] Failed to save:', error)
      if (Platform.OS !== 'web') {
        Alert.alert('Lỗi', `Không thể lưu thông tin: ${error.message || 'Lỗi không xác định'}`)
      } else {
        alert(`Lỗi: ${error.message || 'Không thể lưu thông tin sắp đội'}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleApplySchedule = async () => {
    if (isAfterEnd) return
    if (!onApplySchedule || draftSchedule.matches.length === 0) {
      await handleSave()
      return
    }

    const invalidTeams = teamOptions
      .map(teamNo => ({ teamNo, count: getTeamPlayers(teamNo).length }))
      .filter(team => team.count !== 2)
    if (invalidTeams.length > 0) {
      Alert.alert(
        STRINGS.host_flow.team_arrangement.not_enough_players,
        STRINGS.host_flow.team_arrangement.invalid_team_count.replace(
          '{info}',
          invalidTeams.map(team => `Đội ${team.teamNo} (${team.count})`).join(', ')
        )
      )
      return
    }

    setSubmitting(true)
    try {
      const playersToSave = optimizationProfile === 'social' ? draftSchedule.players : arrangedPlayers
      const assignments = playersToSave
        .filter(p => p.team > 0)
        .map(p => ({
          player_id: p.id,
          team_no: p.team
        }))

      const { error: saveError } = await supabase.rpc('save_session_teams', {
        p_session_id: sessionId,
        p_assignments: assignments
      })

      if (saveError) throw saveError

      onApplySchedule({
        matches: draftSchedule.matches,
        players: draftSchedule.players,
        quality: {
          runtimeMs: draftSchedule.quality.runtimeMs,
          timedOut: draftSchedule.quality.timedOut,
          fallbackUsed: draftSchedule.quality.fallbackUsed,
        },
        mode: optimizationProfile === 'social' ? 'limited' : 'full',
        minGames: optimizationProfile === 'social' ? targetGamesPerTeam : 1,
      })
      onUpdated()
      onClose()
    } catch (error: any) {
      console.error('[TeamArrangement] Failed to apply schedule:', error)
      if (Platform.OS !== 'web') {
        Alert.alert('Lỗi', `Không thể áp dụng lịch: ${error.message || 'Lỗi không xác định'}`)
      } else {
        alert(`Lỗi: ${error.message || 'Không thể áp dụng lịch'}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const getTeamPlayers = (t: number) => displayPlayers.filter(p => p.team === t)
  
  const AVATAR_COLORS = [
    { bg: theme.primaryContainer, text: theme.onPrimaryContainer },
    { bg: theme.successContainer, text: theme.success },
    { bg: theme.warningContainer, text: theme.warning },
    { bg: theme.dangerContainer, text: theme.danger },
    { bg: theme.surfaceContainerHighest, text: theme.onSurface },
  ]
  const getAvatarColor = (name: string) => {
    const safeName = name || ''
    const charCode = safeName.length > 0 ? safeName.charCodeAt(0) : 0
    const index = charCode % AVATAR_COLORS.length
    return AVATAR_COLORS[index]
  }
  const getInitialsLocal = (name: string) => {
    if (!name) return '?'
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  const isWeb = Platform.OS === 'web'
  const totalSkill = displayPlayers.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
  const targetBalance = targetNumTeams > 0 ? totalSkill / targetNumTeams : 0
  const maxSkill = 12.0

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          {hasOngoingMatches && (
            <View style={{ 
              backgroundColor: theme.dangerContainer, 
              padding: 12, 
              borderRadius: 12, 
              borderWidth: 1, 
              borderColor: theme.dangerSoft,
              marginBottom: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10
            }}>
              <ShieldCheck size={20} color={theme.danger} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.danger, fontWeight: '700' }}>{t('team_arrangement.ongoing_match_title')}</Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.danger }}>{t('team_arrangement.ongoing_match_desc')}</Text>
              </View>
            </View>
          )}

          {/* Optimization Profile */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '600', color: theme.outline, marginBottom: 10, letterSpacing: 0.5 }}>
              {t('team_arrangement.optimization_priority')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { key: 'social', label: t('team_arrangement.social_optimization'), hint: t('team_arrangement.social_optimization_hint') },
              ].map(option => {
                const selected = optimizationProfile === option.key
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => handleOptimizationProfileChange(option.key as any)}
                    activeOpacity={0.85}
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: selected ? theme.success : theme.outlineVariant,
                      backgroundColor: selected ? theme.successContainer : theme.surface,
                      paddingHorizontal: 8,
                      paddingVertical: 9,
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: selected ? theme.success : theme.onSurface, fontWeight: '900', textAlign: 'center' }}>
                      {option.label}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: theme.outline, textAlign: 'center', marginTop: 2 }} numberOfLines={1}>
                      {option.hint}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {optimizationProfile === 'social' && (
            <View style={{ marginBottom: 24, backgroundColor: theme.successContainer, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.successSoft }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: theme.success, marginBottom: 8 }}>
                {t('team_arrangement.target_games_per_team')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setTargetGamesPerTeam(n)}
                    style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: targetGamesPerTeam === n ? theme.success : theme.surface,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: theme.success
                    }}
                  >
                    <Text style={{ color: targetGamesPerTeam === n ? theme.surface : theme.success, fontWeight: '700' }}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.success, marginTop: 8, fontStyle: 'italic' }}>
                {t('team_arrangement.target_games_desc', { count: targetGamesPerTeam })}
              </Text>

              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.successSoft }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: theme.success, marginBottom: 10 }}>
                  {t('team_arrangement.pairing_mode')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { key: 'fixed', label: t('team_arrangement.fixed_pair'), icon: '🔒' },
                    { key: 'rotation', label: t('team_arrangement.rotation'), icon: '🔄' },
                  ].map(mode => {
                    const active = socialSubMode === mode.key
                    return (
                      <TouchableOpacity
                        key={mode.key}
                        onPress={() => setSocialSubMode(mode.key as any)}
                        style={{
                          flex: 1,
                          backgroundColor: active ? theme.success : theme.surface,
                          paddingVertical: 10,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: theme.success,
                          alignItems: 'center',
                          flexDirection: 'row',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <Text style={{ fontSize: 12 }}>{mode.icon}</Text>
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 11, 
                          color: active ? theme.surface : theme.success,
                          fontWeight: '700' 
                        }}>
                          {mode.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: theme.success, marginTop: 6, fontStyle: 'italic', opacity: 0.8 }}>
                  {socialSubMode === 'rotation' 
                    ? t('team_arrangement.rotation_hint') 
                    : t('team_arrangement.fixed_pair_hint')}
                </Text>
                {hasFixedPairWaitingPlayers && (
                  <View style={{
                    marginTop: 10,
                    backgroundColor: '#FEF3C7',
                    borderWidth: 1,
                    borderColor: '#F59E0B',
                    borderRadius: 8,
                    padding: 10,
                  }}>
                    <Text style={{
                      fontFamily: SCREEN_FONTS.headline,
                      fontSize: 11,
                      color: '#92400E',
                      fontWeight: '900',
                    }}>
                      {STRINGS.host_flow.team_arrangement.waiting_no_partner.replace(
                        '{count}',
                        String(fixedPairWaitingPlayers.length)
                      )}
                    </Text>
                    <Text style={{
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 10,
                      color: '#92400E',
                      marginTop: 4,
                      lineHeight: 15,
                    }}>
                      {STRINGS.host_flow.team_arrangement.waiting_no_partner_hint.replace(
                        '{names}',
                        fixedPairWaitingNames
                      )}
                    </Text>
                  </View>
                )}
              </View>

                <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.successSoft }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: theme.success, marginBottom: 8 }}>
                    {t('team_arrangement.test_courts')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                    {Array.from({ length: Math.max(4, Math.floor(players.length / 4)) }, (_, i) => i + 1).map(n => (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setTempCourtCount(n)}
                        style={{
                          width: 36, height: 36, borderRadius: 18,
                          marginBottom: 5,
                          backgroundColor: tempCourtCount === n ? theme.success : theme.surface,
                          alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: theme.success
                        }}
                      >
                        <Text style={{ fontSize: 12, color: tempCourtCount === n ? theme.surface : theme.success, fontWeight: '700' }}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => setRebalanceTick(prev => prev + 1)}
                    style={{
                      backgroundColor: theme.success,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 10,
                      ...LAYOUT_SHADOW.sm
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.surface, fontWeight: '900' }}>
                      {t('team_arrangement.rebalance')}
                    </Text>
                    {draftSchedule && draftSchedule.quality && (
                      <View style={{ 
                        backgroundColor: 'rgba(255,255,255,0.25)', 
                        paddingHorizontal: 8, 
                        paddingVertical: 2, 
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.3)'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: 'white', fontWeight: '900' }}>
                          {draftSchedule.quality.overallScore || 0}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

          {/* Preview Grid Header */}
          <TouchableOpacity 
            onPress={() => setPreviewExpanded(!previewExpanded)}
            activeOpacity={0.7}
            style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: 12,
              backgroundColor: theme.surfaceContainerLow,
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.outlineVariant
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: theme.onSurface }}>
                {t('team_arrangement.preview_roster', { count: teamOptions.length })}
              </Text>
            </View>
            {previewExpanded ? <ChevronDown size={16} color={theme.outline} /> : <ChevronRight size={16} color={theme.outline} />}
          </TouchableOpacity>
          
          {previewExpanded && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 24 }}>
            {teamOptions.map((tOption) => {
              const ps = getTeamPlayers(tOption)
              const teamSkill = ps.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
              const balance = teamSkill - targetBalance
              const isEmpty = ps.length === 0

              const balanceStyle = balance > 0
                ? { bg: theme.successContainer, color: theme.success, label: `+${balance.toFixed(2)}` }
                : balance < 0
                ? { bg: theme.dangerContainer, color: theme.danger, label: balance.toFixed(2) }
                : { bg: theme.surfaceContainerHighest, color: theme.onSurfaceVariant, label: t('team_arrangement.balanced') }
              
              return (
                <View key={tOption} style={{ 
                  width: '48.5%', 
                  backgroundColor: isEmpty ? theme.surfaceContainerLowest : theme.surface, 
                  borderRadius: 12, 
                  borderWidth: 0.5, 
                  borderColor: isEmpty ? theme.outline : theme.outlineVariant,
                  borderStyle: isEmpty ? 'dashed' : 'solid',
                  overflow: 'hidden',
                }}>
                  <View style={{ 
                    paddingHorizontal: 12, 
                    paddingVertical: 5,
                    backgroundColor: isEmpty ? theme.outline : theme.success,
                  }}>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, 
                      fontSize: 11, 
                      color: theme.surface,
                      fontWeight: '700'
                    }}>{t('team_arrangement.team_label', { num: tOption })}</Text>
                  </View>
                  
                  {isEmpty ? (
                    <View style={{ height: 100, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 18 }}>👤</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline, fontStyle: 'italic' }}>{t('team_arrangement.empty_team')}</Text>
                    </View>
                  ) : (
                    <View style={{ padding: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 24, 
                          color: theme.onSurface,
                          fontWeight: '900'
                        }}>
                          {teamSkill.toFixed(2)}
                        </Text>
                        <View style={{ 
                          backgroundColor: balanceStyle.bg, 
                          paddingHorizontal: 6, 
                          paddingVertical: 2, 
                          borderRadius: 4
                        }}>
                          <Text style={{ 
                            fontFamily: SCREEN_FONTS.label, 
                            fontSize: 10, 
                            color: balanceStyle.color,
                            fontWeight: '700'
                          }}>
                            {balanceStyle.label}
                          </Text>
                        </View>
                      </View>

                      <View style={{ height: 4, backgroundColor: theme.surfaceContainerHighest, borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
                        <View style={{ 
                          height: '100%', 
                          width: `${Math.min(100, (teamSkill / maxSkill) * 100)}%`,
                          backgroundColor: balance < 0 ? theme.danger : theme.success 
                        }} />
                      </View>
                      
                      <View style={{ gap: 0 }}>
                        {ps.map((player, idx) => {
                          const initials = getInitialsLocal(player.name || 'N')
                          const isFemale = String(player.gender || '').toLowerCase() === 'female' || String(player.gender || '').toLowerCase() === 'nữ'
                          const avatar = getAvatarColor(player.name || '')
                          return (
                            <View
                              key={player.id || `team-${tOption}-p-${idx}`}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingVertical: 6,
                                borderTopWidth: idx > 0 ? 0.5 : 0,
                                borderTopColor: '#F0EDE5',
                                gap: 6,
                              }}
                            >
                              <View style={{ position: 'relative' }}>
                                <View style={{
                                  width: 22, height: 22, borderRadius: 11,
                                  backgroundColor: avatar.bg,
                                  alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <Text style={{ fontSize: 9, fontFamily: SCREEN_FONTS.headline, color: avatar.text, fontWeight: '700' }}>{initials}</Text>
                                </View>
                                <View style={{ 
                                  position: 'absolute', bottom: -1, right: -1,
                                  width: 7, height: 7, borderRadius: 3.5,
                                  backgroundColor: isFemale ? theme.danger : theme.success,
                                  borderWidth: 1.5, borderColor: theme.surface,
                                }} />
                              </View>

                              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontFamily: SCREEN_FONTS.label, fontWeight: '600', color: theme.onSurface }}>
                                {player.name}
                              </Text>

                              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: theme.outline, fontWeight: '700' }}>
                                {Number(player.pvna || 0).toFixed(2)}
                              </Text>
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
          )}

          {/* Distribution Detail Header */}
          <TouchableOpacity 
            onPress={() => setDistributionExpanded(!distributionExpanded)}
            activeOpacity={0.7}
            style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: 12,
              backgroundColor: theme.surfaceContainerLow,
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.outlineVariant
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: theme.onSurface }}>
                {t('team_arrangement.detailed_distribution', { count: arrangedPlayers.length })}
              </Text>
            </View>
            {distributionExpanded ? <ChevronDown size={16} color={theme.outline} /> : <ChevronRight size={16} color={theme.outline} />}
          </TouchableOpacity>
          
          {distributionExpanded && (
            <View style={{ marginBottom: 30 }}>
            {[...displayPlayers].sort((a, b) => a.team - b.team).map((player, pIdx) => {
              const avatar = getAvatarColor(player.name || '')
              const initials = getInitialsLocal(player.name || 'N')
              const isFemale = String(player.gender || '').toLowerCase() === 'female' || String(player.gender || '').toLowerCase() === 'nữ'
              const teamIndex = player.team > 0 ? player.team - 1 : null

              return (
                <View key={player.id || pIdx} style={{ 
                  flexDirection: 'row', alignItems: 'center', 
                  backgroundColor: theme.surface,
                  padding: 10, borderRadius: 12,
                  borderWidth: 0.5, borderColor: theme.outlineVariant,
                  marginBottom: 8, gap: 10,
                  ...LAYOUT_SHADOW.xs
                }}>
                  <View style={{ position: 'relative' }}>
                    <View style={{
                      width: 34, height: 34, borderRadius: 17,
                      backgroundColor: avatar.bg,
                      alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.headline, color: avatar.text, fontWeight: '700' }}>{initials}</Text>
                    </View>
                    <View style={{ 
                      position: 'absolute', bottom: -1, right: -1,
                      width: 9, height: 9, borderRadius: 4.5,
                      backgroundColor: isFemale ? theme.danger : theme.success,
                      borderWidth: 1.5, borderColor: theme.surface,
                    }} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, fontWeight: '600', color: theme.onSurface }} numberOfLines={1}>{player.name}</Text>
                      
                      {/* Preferences */}
                      {player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any' && (
                        <View style={{ backgroundColor: player.metadata.partner_gender_pref === 'female' ? theme.dangerContainer : theme.successContainer, paddingHorizontal: 4, borderRadius: 4 }}>
                          <Text style={{ fontSize: 8, color: player.metadata.partner_gender_pref === 'female' ? theme.danger : theme.success, fontWeight: '800' }}>🤝{player.metadata.partner_gender_pref === 'male' ? 'M' : 'F'}</Text>
                        </View>
                      )}
                      {player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any' && (
                        <View style={{ backgroundColor: player.metadata.opponent_gender_pref === 'female' ? theme.dangerContainer : theme.successContainer, paddingHorizontal: 4, borderRadius: 4 }}>
                          <Text style={{ fontSize: 8, color: player.metadata.opponent_gender_pref === 'female' ? theme.danger : theme.success, fontWeight: '800' }}>⚔️{player.metadata.opponent_gender_pref === 'male' ? 'M' : 'F'}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline }}>{t('team_arrangement.skill_level', { skill: Number(player.pvna || 0).toFixed(2) })}</Text>
                  </View>

                  {activePlayerId === player.id ? (
                    <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 10 }}>
                        <TouchableOpacity
                          onPress={() => {
                            setArrangedPlayers(prev => prev.map(ap => ap.id === player.id ? { ...ap, team: 0 } : ap))
                            setActivePlayerId(null)
                          }}
                          style={{
                            paddingHorizontal: 12, height: 34, borderRadius: 17,
                            backgroundColor: player.team === 0 ? theme.warningContainer : theme.surfaceContainerHighest,
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 1, borderColor: player.team === 0 ? theme.warning : theme.outlineVariant
                          }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: '700', color: player.team === 0 ? theme.warning : theme.outline, fontFamily: SCREEN_FONTS.label }}>{t('team_arrangement.substitute')}</Text>
                        </TouchableOpacity>

                        {teamOptions.map(tOption => (
                          <TouchableOpacity
                            key={tOption}
                            onPress={() => {
                              setArrangedPlayers(prev => prev.map(ap => ap.id === player.id ? { ...ap, team: tOption } : ap))
                              setActivePlayerId(null)
                            }}
                            style={{
                              paddingHorizontal: 12, height: 34, borderRadius: 17,
                              backgroundColor: player.team === tOption ? theme.successContainer : theme.surfaceContainerHighest,
                              alignItems: 'center', justifyContent: 'center',
                              borderWidth: 1, borderColor: player.team === tOption ? theme.success : theme.outlineVariant
                            }}
                          >
                            <Text style={{ fontSize: 10, fontWeight: '700', color: player.team === tOption ? theme.success : theme.outline, fontFamily: SCREEN_FONTS.label }}>{t('team_arrangement.team_label_short', { num: tOption })}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      onPress={() => setActivePlayerId(player.id)}
                      style={{
                        backgroundColor: teamIndex === null ? theme.warningContainer : theme.successContainer,
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        borderWidth: 0.5, borderColor: teamIndex === null ? theme.warningSoft : theme.successSoft
                      }}
                    >
                      <Text style={{
                        fontSize: 10, fontWeight: '700',
                        color: teamIndex === null ? theme.warning : theme.success,
                        fontFamily: SCREEN_FONTS.label,
                      }}>
                        {teamIndex === null ? t('team_arrangement.substitute') : t('team_arrangement.team_label_short', { num: player.team })} ↺
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
          </View>
          )}

          {/* Live schedule draft */}
          {draftSchedule.matches.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#7A8884', letterSpacing: 0.5 }}>
                  LỊCH NHÁP TỪ CÁC CẶP
                </Text>
                <TouchableOpacity 
                  onPress={() => setShowDetailedSchedule(!showDetailedSchedule)}
                  style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '800' }}>
                    {showDetailedSchedule ? 'THU GỌN' : 'XEM CHI TIẾT SÂN'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScheduleCoverageReport 
                schedule={draftSchedule.matches} 
                players={draftSchedule.players}
                minGamesPerPlayer={targetGamesPerTeam}
                variant={optimizationProfile === 'social' ? (socialSubMode === 'rotation' ? 'rotation' : 'social') : 'fixed'}
                quality={draftSchedule.quality}
              />

              {showDetailedSchedule && (
                <View style={{ backgroundColor: '#F9F8F4', borderRadius: 12, borderWidth: 1, borderColor: '#E5E3DC', overflow: 'hidden', marginTop: 12 }}>
                  {(() => {
                    const rotations = Array.from(new Set(draftSchedule.matches.map(m => m.rotation))).sort((a, b) => a - b)
                    return rotations.map(r => {
                      const matchesInR = draftSchedule.matches.filter(m => m.rotation === r).sort((a, b) => a.court - b.court)
                      return (
                        <View key={`rot-${r}`} style={{ borderBottomWidth: 1, borderBottomColor: '#E5E3DC', padding: 12 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900', marginBottom: 8 }}>
                            VÒNG {r}
                          </Text>
                          <View style={{ gap: 8 }}>
                            {matchesInR.map((match, mIdx) => {
                              const teamAName = match.teamA.map(id => displayPlayers.find(p => String(p.id) === id)?.name || 'N/A').join(' / ')
                              const teamBName = match.teamB.map(id => displayPlayers.find(p => String(p.id) === id)?.name || 'N/A').join(' / ')
                              return (
                                <View key={`match-${r}-${match.court}-${mIdx}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                  <View style={{ width: 45, backgroundColor: '#E1F5EE', borderRadius: 4, paddingVertical: 4, alignItems: 'center' }}>
                                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#0F6E56', fontWeight: '800' }}>SÂN {match.court}</Text>
                                  </View>
                                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#1A2E2A', fontWeight: '700' }} numberOfLines={1}>
                                    Đ{match.teamANo}: {teamAName} vs Đ{match.teamBNo}: {teamBName}
                                  </Text>
                                </View>
                              )
                            })}
                          </View>
                        </View>
                      )
                    })
                  })()}
                </View>
              )}
            </View>
          )}

          <BrandedFooter />
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* Bottom Bar */}
      <View style={{ 
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 20, 
        paddingTop: 16, 
        paddingBottom: isWeb ? 20 : (Platform.OS === 'ios' ? 34 : 20), 
        backgroundColor: 'white',
        borderTopWidth: 0.5,
        borderTopColor: '#E5E3DC',
        flexDirection: 'row',
        gap: 12
      }}>
        <TouchableOpacity 
          onPress={onClose}
          style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E3DC', alignItems: 'center' }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, fontWeight: '700', color: '#7A8884', textTransform: 'uppercase' }}>Hủy</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={handleApplySchedule}
          disabled={submitting || isAfterEnd}
          style={{ 
            flex: 2, 
            paddingVertical: 14, 
            borderRadius: 12, 
            backgroundColor: '#0F6E56', 
            alignItems: 'center',
            opacity: (submitting || isAfterEnd) ? 0.7 : 1,
            ...LAYOUT_SHADOW.sm
          }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, fontWeight: '700', color: 'white', textTransform: 'uppercase' }}>
            {submitting ? 'ĐANG LƯU...' : (isAfterEnd ? 'ĐÃ ĐÓNG' : (onApplySchedule ? 'Áp dụng lịch này' : 'Lưu sắp xếp'))}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
