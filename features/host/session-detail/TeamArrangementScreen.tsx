import React, { useState } from 'react'
import { Text, View, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react-native'
import { getInitials, type ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { BrandedFooter } from '@/components/design/BrandedFooter'
import { arrangeFixedTeams } from '@/lib/scheduler/fixedTeamPairing'
import { buildFixedTeamScheduleDraft, type FixedTeamScheduledMatch } from '@/lib/scheduler/fixedTeamSchedule'
import { getTeamSkill, hasCompleteFixedPair, type FixedTeamOptimizationProfile } from '@/lib/scheduler/scoring'
import { optimizeSocialPlan } from '@/lib/scheduler/socialOptimizer'
import { optimizeRotationPlan } from '@/lib/scheduler/rotationOptimizer'
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
  const maxTeamCount = Math.max(1, Math.floor(players.length / 2))
  const defaultTeamCount = Math.max(1, Math.min(maxTeamCount, Math.ceil(players.length / 2)))
  const [arrangedPlayers, setArrangedPlayers] = useState<ArrangementPlayer[]>(players)
  const [submitting, setSubmitting] = useState(false)
  const [targetNumTeams, setTargetNumTeams] = useState(defaultTeamCount)
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)
  const [hasOngoingMatches, setHasOngoingMatches] = useState(false)
  const [checkingMatches, setCheckingMatches] = useState(false)
  const [optimizationProfile, setOptimizationProfile] = useState<FixedTeamOptimizationProfile | 'social'>('balanced')
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

    setArrangedPlayers(hasCompleteFixedPair(players) ? players : arrangeFixedTeams(players, defaultTeamCount, { profile: optimizationProfile, preserveExistingPairs: false }))
    setTargetNumTeams(defaultTeamCount)
    checkOngoing()
  }, [defaultTeamCount, optimizationProfile, players, sessionId])

  const teamOptions = Array.from({ length: targetNumTeams }, (_, i) => i + 1)

  const hasFixedPairs = () => hasCompleteFixedPair(arrangedPlayers)
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

  const autoBalanceTeams = () => {
    if (isAfterEnd) return
    setArrangedPlayers(arrangeFixedTeams(arrangedPlayers, targetNumTeams, { profile: optimizationProfile, preserveExistingPairs: false }))
  }

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

  const handleTeamCountChange = (teamCount: number) => {
    setTargetNumTeams(teamCount)
    if (isAfterEnd) return
    setArrangedPlayers(current => arrangeFixedTeams(current, teamCount, { profile: optimizationProfile, preserveExistingPairs: false }))
  }

  const totalPlayers = arrangedPlayers.length
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
        'Chua du doi',
        `Moi doi can dung 2 nguoi. Doi can chinh: ${invalidTeams.map(team => `Doi ${team.teamNo} (${team.count})`).join(', ')}`
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
        'Chua du doi',
        `Moi doi can dung 2 nguoi. Doi can chinh: ${invalidTeams.map(team => `Doi ${team.teamNo} (${team.count})`).join(', ')}`
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
    { bg: '#EDE4FE', text: '#5B2D9E' },
    { bg: '#E1F5EE', text: '#0F6E56' },
    { bg: '#FAEEDA', text: '#854F0B' },
    { bg: '#FAECE7', text: '#993C1D' },
    { bg: '#F1EFE8', text: '#7A8884' },
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
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          {hasOngoingMatches && (
            <View style={{ 
              backgroundColor: '#FAECE7', 
              padding: 12, 
              borderRadius: 12, 
              borderWidth: 1, 
              borderColor: '#fee2e2',
              marginBottom: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10
            }}>
              <ShieldCheck size={20} color="#dc2626" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#991b1b', fontWeight: '700' }}>Đang có trận đấu diễn ra!</Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#b91c1c' }}>Cân nhắc kỹ trước khi đổi đội hình.</Text>
              </View>
            </View>
          )}

          {/* Team Count Selector */}
          <View style={{ marginBottom: 24 }}>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.label, 
              fontSize: 11, 
              fontWeight: '600',
              color: '#7A8884', 
              marginBottom: 10,
              letterSpacing: 0.5
            }}>SỐ LƯỢNG ĐỘI (Tham gia: {totalPlayers}/{maxPlayers})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {Array.from({ length: maxTeamCount }, (_, i) => i + 1).map(n => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => handleTeamCountChange(n)}
                    activeOpacity={0.8}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 7,
                      borderRadius: 999,
                      backgroundColor: targetNumTeams === n ? '#0F6E56' : 'white',
                      borderWidth: 1.5,
                      borderColor: targetNumTeams === n ? '#0F6E56' : '#E5E3DC',
                    }}
                  >
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.label, 
                      fontSize: 12, 
                      fontWeight: '600',
                      color: targetNumTeams === n ? 'white' : '#7A8884' 
                    }}>
                      {n} Đội
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Optimization Profile */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '600', color: '#7A8884', marginBottom: 10, letterSpacing: 0.5 }}>
              ƯU TIÊN TỐI ƯU
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { key: 'balanced', label: 'Cân bằng', hint: 'Pref + trình' },
                { key: 'skill', label: 'Cân trình', hint: 'Ít lệch điểm' },
                { key: 'social', label: 'Tối ưu Social', hint: 'Ghép & Xếp linh hoạt' },
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
                      borderColor: selected ? '#0F6E56' : '#E5E3DC',
                      backgroundColor: selected ? '#E1F5EE' : 'white',
                      paddingHorizontal: 8,
                      paddingVertical: 9,
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: selected ? '#0F6E56' : '#1A2E2A', fontWeight: '900', textAlign: 'center' }}>
                      {option.label}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', textAlign: 'center', marginTop: 2 }} numberOfLines={1}>
                      {option.hint}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {optimizationProfile === 'social' && (
            <View style={{ marginBottom: 24, backgroundColor: '#F0FDF4', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#DCFCE7' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#166534', marginBottom: 8 }}>
                MỤC TIÊU SỐ TRẬN MỖI ĐỘI
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setTargetGamesPerTeam(n)}
                    style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: targetGamesPerTeam === n ? '#166534' : 'white',
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: '#166534'
                    }}
                  >
                    <Text style={{ color: targetGamesPerTeam === n ? 'white' : '#166534', fontWeight: '700' }}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#166534', marginTop: 8, fontStyle: 'italic' }}>
                * Mỗi người sẽ chơi đúng {targetGamesPerTeam} trận.
              </Text>

              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#DCFCE7' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#166534', marginBottom: 10 }}>
                  CHẾ ĐỘ GHÉP CẶP
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { key: 'fixed', label: 'Cố định cặp', icon: '🔒' },
                    { key: 'rotation', label: 'Xoay vòng', icon: '🔄' },
                  ].map(mode => {
                    const active = socialSubMode === mode.key
                    return (
                      <TouchableOpacity
                        key={mode.key}
                        onPress={() => setSocialSubMode(mode.key as any)}
                        style={{
                          flex: 1,
                          backgroundColor: active ? '#166534' : 'white',
                          paddingVertical: 10,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#166534',
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
                          color: active ? 'white' : '#166534',
                          fontWeight: '700' 
                        }}>
                          {mode.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#166534', marginTop: 6, fontStyle: 'italic', opacity: 0.8 }}>
                  {socialSubMode === 'rotation' 
                    ? '• Ưu tiên Partner mới mỗi trận • Coi mỗi người là cá nhân độc lập' 
                    : '• Giữ nguyên Team hiện tại • Chỉ tối ưu hóa đối thủ và khoảng nghỉ'}
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
                      CO {fixedPairWaitingPlayers.length} NGUOI CHUA CO CAP
                    </Text>
                    <Text style={{
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 10,
                      color: '#92400E',
                      marginTop: 4,
                      lineHeight: 15,
                    }}>
                      {fixedPairWaitingNames} se ngoi ngoai lich co dinh cap. Chuyen sang Xoay vong neu muon tat ca nguoi choi duoc xep tran.
                    </Text>
                  </View>
                )}
              </View>

                <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#DCFCE7' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#166534', marginBottom: 8 }}>
                    SỐ SÂN SỬ DỤNG ĐỂ TEST LỊCH
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                    {Array.from({ length: Math.max(4, Math.floor(players.length / 4)) }, (_, i) => i + 1).map(n => (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setTempCourtCount(n)}
                        style={{
                          width: 36, height: 36, borderRadius: 18,
                          marginBottom: 5,
                          backgroundColor: tempCourtCount === n ? '#166534' : 'white',
                          alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: '#166534'
                        }}
                      >
                        <Text style={{ fontSize: 12, color: tempCourtCount === n ? 'white' : '#166534', fontWeight: '700' }}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => setRebalanceTick(prev => prev + 1)}
                    style={{
                      backgroundColor: '#166534',
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 10,
                      ...LAYOUT_SHADOW.sm
                    }}
                  >
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
                      CÂN BẰNG LẠI
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

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', marginBottom: 24 }}>
            <TouchableOpacity 
              onPress={autoBalanceTeams}
              activeOpacity={0.8}
              style={{ 
                flex: 1,
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: 8, 
                backgroundColor: '#0F6E56', 
                paddingVertical: 14, 
                borderRadius: 12,
                ...LAYOUT_SHADOW.sm,
                opacity: isAfterEnd ? 0.5 : 1
              }}
              disabled={isAfterEnd}
            >
              <ShieldCheck size={18} color="white" />
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 14, 
                fontWeight: '700',
                color: 'white',
                textTransform: 'uppercase'
              }}>{hasFixedPairs() ? 'Cân bằng cặp' : 'Tạo cặp cố định'}</Text>
            </TouchableOpacity>

          </View>

          {/* Preview Grid Header */}
          <TouchableOpacity 
            onPress={() => setPreviewExpanded(!previewExpanded)}
            activeOpacity={0.7}
            style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: 12,
              backgroundColor: '#F8FAF9',
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#E5E3DC'
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#1A2E2A' }}>
                📋 XEM TRƯỚC ĐỘI HÌNH ({teamOptions.length} ĐỘI)
              </Text>
            </View>
            {previewExpanded ? <ChevronDown size={16} color="#7A8884" /> : <ChevronRight size={16} color="#7A8884" />}
          </TouchableOpacity>
          
          {previewExpanded && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 24 }}>
            {teamOptions.map((t) => {
              const ps = getTeamPlayers(t)
              const teamSkill = ps.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
              const balance = teamSkill - targetBalance
              const isEmpty = ps.length === 0

              const balanceStyle = balance > 0
                ? { bg: '#E1F5EE', color: '#0F6E56', label: `+${balance.toFixed(2)}` }
                : balance < 0
                ? { bg: '#FAECE7', color: '#993C1D', label: balance.toFixed(2) }
                : { bg: '#F1EFE8', color: '#B4B2A9', label: 'Cân bằng' }
              
              return (
                <View key={t} style={{ 
                  width: '48.5%', 
                  backgroundColor: isEmpty ? '#FAFAF7' : '#F9F9F7', 
                  borderRadius: 12, 
                  borderWidth: 0.5, 
                  borderColor: isEmpty ? '#D5D2C8' : '#E5E3DC',
                  borderStyle: isEmpty ? 'dashed' : 'solid',
                  overflow: 'hidden',
                }}>
                  <View style={{ 
                    paddingHorizontal: 12, 
                    paddingVertical: 5,
                    backgroundColor: isEmpty ? '#B4B2A9' : '#0F6E56',
                  }}>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, 
                      fontSize: 11, 
                      color: 'white',
                      fontWeight: '700'
                    }}>ĐỘI {t}</Text>
                  </View>
                  
                  {isEmpty ? (
                    <View style={{ height: 100, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 18 }}>👤</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', fontStyle: 'italic' }}>Chưa có người</Text>
                    </View>
                  ) : (
                    <View style={{ padding: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 24, 
                          color: '#1A2E2A',
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

                      <View style={{ height: 4, backgroundColor: '#E5E3DC', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
                        <View style={{ 
                          height: '100%', 
                          width: `${Math.min(100, (teamSkill / maxSkill) * 100)}%`,
                          backgroundColor: balance < 0 ? '#D85A30' : '#0F6E56' 
                        }} />
                      </View>
                      
                      <View style={{ gap: 0 }}>
                        {ps.map((player, idx) => {
                          const initials = getInitialsLocal(player.name || 'N')
                          const isFemale = String(player.gender || '').toLowerCase() === 'female' || String(player.gender || '').toLowerCase() === 'nữ'
                          const avatar = getAvatarColor(player.name || '')
                          return (
                            <View
                              key={player.id || `team-${t}-p-${idx}`}
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
                                  backgroundColor: isFemale ? '#D85A30' : '#0F6E56',
                                  borderWidth: 1.5, borderColor: 'white',
                                }} />
                              </View>

                              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontFamily: SCREEN_FONTS.label, fontWeight: '600', color: '#1A2E2A' }}>
                                {player.name}
                              </Text>

                              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#7A8884', fontWeight: '700' }}>
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
              backgroundColor: '#F8FAF9',
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#E5E3DC'
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#1A2E2A' }}>
                👥 PHÂN BỔ CHI TIẾT ({arrangedPlayers.length} NGƯỜI)
              </Text>
            </View>
            {distributionExpanded ? <ChevronDown size={16} color="#7A8884" /> : <ChevronRight size={16} color="#7A8884" />}
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
                  backgroundColor: 'white',
                  padding: 10, borderRadius: 12,
                  borderWidth: 0.5, borderColor: '#E5E3DC',
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
                      backgroundColor: isFemale ? '#D85A30' : '#0F6E56',
                      borderWidth: 1.5, borderColor: 'white',
                    }} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, fontWeight: '600', color: '#1A2E2A' }} numberOfLines={1}>{player.name}</Text>
                      
                      {/* Preferences */}
                      {player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any' && (
                        <View style={{ backgroundColor: player.metadata.partner_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', paddingHorizontal: 4, borderRadius: 4 }}>
                          <Text style={{ fontSize: 8, color: player.metadata.partner_gender_pref === 'female' ? '#993C1D' : '#0F6E56', fontWeight: '800' }}>🤝{player.metadata.partner_gender_pref === 'male' ? 'M' : 'F'}</Text>
                        </View>
                      )}
                      {player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any' && (
                        <View style={{ backgroundColor: player.metadata.opponent_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', paddingHorizontal: 4, borderRadius: 4 }}>
                          <Text style={{ fontSize: 8, color: player.metadata.opponent_gender_pref === 'female' ? '#993C1D' : '#0F6E56', fontWeight: '800' }}>⚔️{player.metadata.opponent_gender_pref === 'male' ? 'M' : 'F'}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884' }}>Trình {Number(player.pvna || 0).toFixed(2)}</Text>
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
                            backgroundColor: player.team === 0 ? '#FAEEDA' : '#F5F1E8',
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 1, borderColor: player.team === 0 ? '#854F0B' : '#E5E3DC'
                          }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: '700', color: player.team === 0 ? '#854F0B' : '#7A8884', fontFamily: SCREEN_FONTS.label }}>DỰ BỊ</Text>
                        </TouchableOpacity>

                        {teamOptions.map(t => (
                          <TouchableOpacity
                            key={t}
                            onPress={() => {
                              setArrangedPlayers(prev => prev.map(ap => ap.id === player.id ? { ...ap, team: t } : ap))
                              setActivePlayerId(null)
                            }}
                            style={{
                              paddingHorizontal: 12, height: 34, borderRadius: 17,
                              backgroundColor: player.team === t ? '#E1F5EE' : '#F5F1E8',
                              alignItems: 'center', justifyContent: 'center',
                              borderWidth: 1, borderColor: player.team === t ? '#0F6E56' : '#E5E3DC'
                            }}
                          >
                            <Text style={{ fontSize: 10, fontWeight: '700', color: player.team === t ? '#0F6E56' : '#7A8884', fontFamily: SCREEN_FONTS.label }}>ĐỘI {t}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      onPress={() => setActivePlayerId(player.id)}
                      style={{
                        backgroundColor: teamIndex === null ? '#FAEEDA' : '#E1F5EE',
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        borderWidth: 0.5, borderColor: teamIndex === null ? '#854F0B20' : '#0F6E5620'
                      }}
                    >
                      <Text style={{
                        fontSize: 10, fontWeight: '700',
                        color: teamIndex === null ? '#854F0B' : '#0F6E56',
                        fontFamily: SCREEN_FONTS.label,
                      }}>
                        {teamIndex === null ? 'DỰ BỊ' : `ĐỘI ${player.team}`} ↺
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
