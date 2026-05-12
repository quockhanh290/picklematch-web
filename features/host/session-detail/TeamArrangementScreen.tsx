import React, { useState } from 'react'
import { Text, View, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { ShieldCheck } from 'lucide-react-native'
import { getInitials, type ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { BrandedFooter } from '@/components/design/BrandedFooter'
import { arrangeFixedTeams } from '@/lib/scheduler/fixedTeamPairing'
import { buildFixedTeamScheduleDraft, type FixedTeamScheduledMatch } from '@/lib/scheduler/fixedTeamSchedule'
import { getTeamSkill, hasCompleteFixedPair, type FixedTeamOptimizationProfile } from '@/lib/scheduler/scoring'
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
  const [optimizationProfile, setOptimizationProfile] = useState<FixedTeamOptimizationProfile>('balanced')

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
    () => buildFixedTeamScheduleDraft(arrangedPlayers, courtCount, optimizationProfile),
    [arrangedPlayers, courtCount, optimizationProfile]
  )

  const autoBalanceTeams = () => {
    if (isAfterEnd) return
    setArrangedPlayers(arrangeFixedTeams(arrangedPlayers, targetNumTeams, { profile: optimizationProfile, preserveExistingPairs: false }))
  }

  const handleOptimizationProfileChange = (profile: FixedTeamOptimizationProfile) => {
    setOptimizationProfile(profile)
    if (isAfterEnd) return
    setArrangedPlayers(current => arrangeFixedTeams(current, targetNumTeams, { profile, preserveExistingPairs: false }))
  }

  const handleTeamCountChange = (teamCount: number) => {
    setTargetNumTeams(teamCount)
    if (isAfterEnd) return
    setArrangedPlayers(current => arrangeFixedTeams(current, teamCount, { profile: optimizationProfile, preserveExistingPairs: false }))
  }

  const totalPlayers = arrangedPlayers.length

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
      // Only send players who are assigned to a team (team > 0)
      const assignments = arrangedPlayers
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
      const assignments = arrangedPlayers
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

  const getTeamPlayers = (t: number) => arrangedPlayers.filter(p => p.team === t)
  
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
  const totalSkill = arrangedPlayers.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
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
                { key: 'preference', label: 'Preference', hint: 'Ưu tiên mong muốn' },
                { key: 'skill', label: 'Cân trình', hint: 'Ít lệch điểm' },
              ].map(option => {
                const selected = optimizationProfile === option.key
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => handleOptimizationProfileChange(option.key as FixedTeamOptimizationProfile)}
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

          {/* Preview Grid */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#7A8884' }}>📋 Xem trước đội hình</Text>
          </View>
          
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

          {/* Distribution Detail */}
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#7A8884', marginBottom: 12, letterSpacing: 0.5 }}>PHÂN BỔ CHI TIẾT</Text>
          <View style={{ marginBottom: 30 }}>
            {[...arrangedPlayers].sort((a, b) => a.team - b.team).map((player, pIdx) => {
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

          {/* Live schedule draft */}
          {draftSchedule.matches.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, fontWeight: '700', color: '#7A8884', marginBottom: 12, letterSpacing: 0.5 }}>
                LỊCH NHÁP TỪ CÁC CẶP
              </Text>
              <ScheduleCoverageReport
                players={draftSchedule.players}
                schedule={draftSchedule.matches}
                mode="full"
                minGamesPerPlayer={1}
                variant="fixed"
                quality={draftSchedule.quality}
              />
              <View style={{ backgroundColor: '#F9F8F4', borderRadius: 12, borderWidth: 1, borderColor: '#E5E3DC', overflow: 'hidden' }}>
                {draftSchedule.matches.slice(0, 8).map((match, idx) => {
                  const teamAName = match.teamA.map(id => arrangedPlayers.find(p => String(p.id) === id)?.name || 'N/A').join(' / ')
                  const teamBName = match.teamB.map(id => arrangedPlayers.find(p => String(p.id) === id)?.name || 'N/A').join(' / ')
                  return (
                    <View key={`${match.rotation}-${match.court}-${idx}`} style={{ padding: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: '#E5E3DC' }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800', marginBottom: 4 }}>
                        Vòng {match.rotation} · Sân {match.court}
                      </Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '800' }} numberOfLines={2}>
                        Đội {match.teamANo}: {teamAName}
                      </Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginVertical: 2 }}>vs</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '800' }} numberOfLines={2}>
                        Đội {match.teamBNo}: {teamBName}
                      </Text>
                    </View>
                  )
                })}
                {draftSchedule.matches.length > 8 && (
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', padding: 10, textAlign: 'center' }}>
                    Còn {draftSchedule.matches.length - 8} trận sẽ hiển thị ở màn quản lý trận sau khi áp dụng.
                  </Text>
                )}
              </View>
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
