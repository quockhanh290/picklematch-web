import React, { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, LayoutAnimation, Platform, Alert, Image, Dimensions, Pressable } from 'react-native'
import { History, CheckCircle2, Plus, Minus, Swords, SwordsIcon } from 'lucide-react-native'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const IS_SMALL_DEVICE = SCREEN_WIDTH < 375
const RESPONSIVE_CARD_WIDTH = SCREEN_WIDTH > 400 ? 80 : SCREEN_WIDTH > 360 ? 70 : 64
const RESPONSIVE_CARD_HEIGHT = RESPONSIVE_CARD_WIDTH * 1.25
const RESPONSIVE_FONT_SIZE = SCREEN_WIDTH > 400 ? 56 : SCREEN_WIDTH > 360 ? 48 : 42
const RESPONSIVE_GAP = SCREEN_WIDTH > 360 ? 8 : 4
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW as LAYOUT_SHADOW, BORDER } from '@/constants/screenLayout'
import type { SessionMatch } from '@/hooks/useSessionDetail'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { BrandedFooter } from '@/components/design/BrandedFooter'

interface Props {
  sessionId: string
  matches: SessionMatch[]
  players: ArrangementPlayer[]
  onUpdated: () => void
  onClose?: () => void
}

export function HostMatchScreen({ sessionId, matches, players, onUpdated }: Omit<Props, 'onClose'>) {
  const theme = useAppTheme()
  const [submitting, setSubmitting] = useState(false)
  const [localScores, setLocalScores] = useState<Record<string, { a: number, b: number }>>({})

  // Sync local scores when matches change, but carefully to avoid flickering
  React.useEffect(() => {
    setLocalScores(prev => {
      const next = { ...prev }
      let changed = false
      matches.forEach(m => {
        if (m.status === 'playing') {
          // Only sync if we don't have it yet, or if the server score is different from our local one
          // and we're not in the middle of a rapid update
          if (!next[m.id] || (next[m.id].a !== m.score_a && next[m.id].b !== m.score_b)) {
             // To prevent jumping, we only overwrite if the server data is actually newer 
             // or if we don't have local state yet
             if (!next[m.id]) {
               next[m.id] = { a: m.score_a, b: m.score_b }
               changed = true
             }
          }
        }
      })
      return changed ? next : prev
    })
  }, [matches])

  const activeMatches = matches.filter(m => m.status === 'playing')
  const historyMatches = matches.filter(m => m.status === 'finished' || m.status === 'cancelled')

  const teamGroups = players.reduce((acc, p) => {
    const t = String(p.team || '0')
    if (t !== '0') {
      if (!acc[t]) acc[t] = []
      acc[t].push(p)
    }
    return acc
  }, {} as Record<string, ArrangementPlayer[]>)

  const teamIds = Object.keys(teamGroups).sort((a, b) => Number(a) - Number(b))

  const handleUpdateScore = async (matchId: string, team: 'a' | 'b', delta: number) => {
    const currentScore = localScores[matchId]?.[team] ?? 0
    const newScore = Math.max(0, currentScore + delta)

    // Optimistic Update
    setLocalScores(prev => ({
      ...prev,
      [matchId]: { ...prev[matchId], [team]: newScore }
    }))

    const { error } = await supabase
      .from('session_matches')
      .update({ [team === 'a' ? 'score_a' : 'score_b']: newScore, updated_at: new Date().toISOString() })
      .eq('id', matchId)

    if (error) {
      // Rollback on error
      setLocalScores(prev => ({
        ...prev,
        [matchId]: { ...prev[matchId], [team]: currentScore }
      }))
      Alert.alert('Lỗi', 'Không thể cập nhật điểm số')
    } else {
      onUpdated()
    }
  }

  const handleFinishMatch = async (matchId: string) => {
    setSubmitting(true)
    const { error } = await supabase
      .from('session_matches')
      .update({ status: 'finished', updated_at: new Date().toISOString() })
      .eq('id', matchId)
    
    setSubmitting(false)
    if (!error) onUpdated()
  }

  const handleCancelMatch = async (matchId: string) => {
    const performCancel = async () => {
      setSubmitting(true)
      const { error } = await supabase
        .from('session_matches')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', matchId)
      
      setSubmitting(false)
      if (error) {
        Alert.alert('Lỗi', 'Không thể hủy trận đấu.')
      } else {
        onUpdated()
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm('Hủy trận đấu này?')) await performCancel()
    } else {
      Alert.alert('Xác nhận', 'Hủy trận đấu này?', [
        { text: 'QUAY LẠI', style: 'cancel' },
        { text: 'HỦY TRẬN', style: 'destructive', onPress: performCancel }
      ])
    }
  }

  const handleCreateMatch = async (teamA: number, teamB: number) => {
    setSubmitting(true)
    const { error } = await supabase.from('session_matches').insert({
      session_id: sessionId,
      team_a_no: teamA,
      team_b_no: teamB,
      players_snapshot: {
        team_a: teamGroups[String(teamA)]?.map(p => p.id) || [],
        team_b: teamGroups[String(teamB)]?.map(p => p.id) || []
      },
      status: 'playing'
    })
    setSubmitting(false)
    if (!error) onUpdated()
  }

  const handleCreateAllMatches = async () => {
    const schedulingTeams = teamIds.length % 2 === 0 ? teamIds : [...teamIds, '0']
    const numRounds = schedulingTeams.length - 1
    const message = `Tạo lịch thi đấu cho tất cả các đội?`
    
    const performCreate = async () => {
      setSubmitting(true)
      // Logic for Circle Method simplified here for brevity, matching Modal logic
      for (let round = 0; round < numRounds; round++) {
        for (let i = 0; i < schedulingTeams.length / 2; i++) {
          const tA = Number(schedulingTeams[i])
          const tB = Number(schedulingTeams[schedulingTeams.length - 1 - i])
          if (tA !== 0 && tB !== 0) {
            await supabase.from('session_matches').insert({
              session_id: sessionId, team_a_no: tA, team_b_no: tB, status: 'playing',
              players_snapshot: { team_a: teamGroups[String(tA)]?.map(p => p.id), team_b: teamGroups[String(tB)]?.map(p => p.id) }
            })
            await new Promise(r => setTimeout(r, 50))
          }
        }
        const last = schedulingTeams.pop()!
        schedulingTeams.splice(1, 0, last)
      }
      setSubmitting(false)
      onUpdated()
    }

    if (Platform.OS === 'web') {
      if (window.confirm(message)) await performCreate()
    } else {
      Alert.alert('Tạo lịch đấu', message, [
        { text: 'HỦY', style: 'cancel' },
        { text: 'TẠO NGAY', onPress: performCreate }
      ])
    }
  }

  const getTeamSkill = (teamNo: number) => {
    const members = teamGroups[String(teamNo)] || []
    if (members.length === 0) return 0
    return members.reduce((sum, p) => sum + (Number(p.pvna || (p.elo / 100) || 0)), 0)
  }

  const getPlayerNames = (teamNo: number) => teamGroups[String(teamNo)]?.map(p => p.name).join(' - ') || `Đội ${teamNo}`

  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A' }}>ĐANG DIỄN RA</Text>
            <View style={{ 
              backgroundColor: activeMatches.length > 0 ? theme.primary : '#F1EFE8', 
              paddingHorizontal: 10, 
              paddingVertical: 4, 
              borderRadius: 999,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: activeMatches.length > 0 ? '#E1F5EE' : '#B4B2A9' }} />
              <View style={{ width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: activeMatches.length > 0 ? '#E1F5EE' : '#B4B2A9' }} />
              <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: activeMatches.length > 0 ? 'white' : '#7A8884' }}>
                {activeMatches.length} TRẬN LIVE
              </Text>
            </View>
          </View>

          {activeMatches.length === 0 ? (
            <View style={{ 
              backgroundColor: '#1A2E2A', 
              borderRadius: RADIUS.xl, 
              height: 200,
              alignItems: 'center', 
              justifyContent: 'center',
              marginTop: 8,
              overflow: 'hidden',
              position: 'relative',
              borderWidth: 1,
              borderColor: '#0F6E5630',
              ...LAYOUT_SHADOW.md
            }}>
              {/* Subtle background pattern or gradient */}
              <View style={{ 
                position: 'absolute', 
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: theme.primary,
                opacity: 0.15
              }} />
              
              <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: '#0F6E56', 
                paddingHorizontal: 12, 
                paddingVertical: 4, 
                borderRadius: 4,
                marginBottom: 16,
                gap: 6
              }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#E1F5EE' }} />
                <Text style={{ color: 'white', fontSize: 10, fontFamily: SCREEN_FONTS.headline, letterSpacing: 1.5, fontWeight: '800' }}>PRE-MATCH</Text>
              </View>

              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 22, 
                color: 'white', 
                textAlign: 'center',
                letterSpacing: 1,
                fontWeight: '900',
                textShadowColor: 'rgba(0,0,0,0.3)',
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 4
              }}>
                TRẬN ĐẤU SẮP BẮT ĐẦU
              </Text>
              
              <Text style={{ 
                fontFamily: SCREEN_FONTS.label, 
                fontSize: 12, 
                color: '#E1F5EE', 
                textAlign: 'center',
                marginTop: 8,
                opacity: 0.8,
                letterSpacing: 0.5
              }}>
                Vui lòng chọn cặp đấu bên dưới để "lên sóng"
              </Text>

              <View style={{ 
                position: 'absolute', 
                bottom: 0, 
                left: 0, 
                right: 0, 
                height: 4, 
                backgroundColor: '#0F6E56',
                opacity: 0.5
              }} />
            </View>
          ) : (
            activeMatches.map(match => {
              const scoreA = localScores[match.id]?.a ?? match.score_a
              const scoreB = localScores[match.id]?.b ?? match.score_b
              
              return (
                <View key={match.id} style={{ 
                  backgroundColor: 'white', 
                  borderRadius: RADIUS.xl, 
                  borderWidth: 1, 
                  borderColor: '#E5E3DC', 
                  marginBottom: 20, 
                  overflow: 'hidden', 
                  ...LAYOUT_SHADOW.sm 
                }}>
                  {/* Card Header */}
                  <View style={{ 
                    backgroundColor: '#F5F1E8', 
                    paddingHorizontal: 16, 
                    paddingVertical: 10, 
                    flexDirection: 'row', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    borderBottomWidth: 1,
                    borderBottomColor: '#E5E3DC'
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0F6E56' }} />
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#0F6E56', fontWeight: '800' }}>TRẬN ĐẤU LIVE</Text>
                    </View>
                    <View style={{ backgroundColor: '#1A2E2A', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.xs }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: 'white', fontWeight: '700' }}>
                        {new Date(match.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={{ padding: 20 }}>
                    {/* Scoreboard Row */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                      
                      {/* Team A Section */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ alignItems: 'center', gap: 12 }}>
                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'a', 1)} 
                            style={({ pressed }) => ({ 
                              width: 40, height: 40, borderRadius: 20, 
                              backgroundColor: '#0F6E56', alignItems: 'center', justifyContent: 'center', 
                              ...LAYOUT_SHADOW.sm,
                              opacity: pressed ? 0.8 : 1
                            })}
                          >
                            <Plus size={20} color="white" />
                          </Pressable>
                          
                          <View style={{ 
                            width: RESPONSIVE_CARD_WIDTH + 10, 
                            height: RESPONSIVE_CARD_HEIGHT + 10, 
                            backgroundColor: '#F5F1E8', 
                            borderRadius: RADIUS.md, 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            borderWidth: 2, 
                            borderColor: scoreA > scoreB ? '#0F6E56' : '#E5E3DC',
                            ...LAYOUT_SHADOW.sm
                          }}>
                            <Text style={{ 
                              fontFamily: SCREEN_FONTS.headline, 
                              fontSize: RESPONSIVE_FONT_SIZE, 
                              color: scoreA > scoreB ? '#0F6E56' : '#1A2E2A', 
                              fontWeight: '900' 
                            }}>{scoreA}</Text>
                          </View>

                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'a', -1)} 
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center', 
                              borderWidth: 1, borderColor: '#E5E3DC',
                              opacity: pressed ? 0.7 : 1
                            })}
                          >
                            <Minus size={18} color="#7A8884" />
                          </Pressable>
                        </View>
                        <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 12, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_a_no}</Text>
                        <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_a_no)}</Text>
                      </View>

                      {/* VS Divider */}
                      <View style={{ paddingHorizontal: 10, alignItems: 'center' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#B4B2A9', fontWeight: '900' }}>VS</Text>
                      </View>

                      {/* Team B Section */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ alignItems: 'center', gap: 12 }}>
                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'b', 1)} 
                            style={({ pressed }) => ({ 
                              width: 40, height: 40, borderRadius: 20, 
                              backgroundColor: '#0F6E56', alignItems: 'center', justifyContent: 'center', 
                              ...LAYOUT_SHADOW.sm,
                              opacity: pressed ? 0.8 : 1
                            })}
                          >
                            <Plus size={20} color="white" />
                          </Pressable>
                          
                          <View style={{ 
                            width: RESPONSIVE_CARD_WIDTH + 10, 
                            height: RESPONSIVE_CARD_HEIGHT + 10, 
                            backgroundColor: '#F5F1E8', 
                            borderRadius: RADIUS.md, 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            borderWidth: 2, 
                            borderColor: scoreB > scoreA ? '#0F6E56' : '#E5E3DC',
                            ...LAYOUT_SHADOW.sm
                          }}>
                            <Text style={{ 
                              fontFamily: SCREEN_FONTS.headline, 
                              fontSize: RESPONSIVE_FONT_SIZE, 
                              color: scoreB > scoreA ? '#0F6E56' : '#1A2E2A', 
                              fontWeight: '900' 
                            }}>{scoreB}</Text>
                          </View>

                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'b', -1)} 
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center', 
                              borderWidth: 1, borderColor: '#E5E3DC',
                              opacity: pressed ? 0.7 : 1
                            })}
                          >
                            <Minus size={18} color="#7A8884" />
                          </Pressable>
                        </View>
                        <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 12, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_b_no}</Text>
                        <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_b_no)}</Text>
                      </View>
                    </View>

                    {/* Bottom Actions */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                      <TouchableOpacity 
                        onPress={() => handleFinishMatch(match.id)} 
                        style={{ 
                          flex: 2, 
                          backgroundColor: '#0F6E56', 
                          paddingVertical: 12, 
                          borderRadius: RADIUS.lg, 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          ...LAYOUT_SHADOW.sm 
                        }}
                      >
                        <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, fontWeight: '800' }}>XÁC NHẬN KẾT QUẢ</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => handleCancelMatch(match.id)} 
                        style={{ 
                          flex: 1, 
                          backgroundColor: '#FAECE7', 
                          paddingVertical: 12, 
                          borderRadius: RADIUS.lg, 
                          alignItems: 'center', 
                          justifyContent: 'center' 
                        }}
                      >
                        <Text style={{ color: '#D85A30', fontFamily: SCREEN_FONTS.headline, fontSize: 13, fontWeight: '800' }}>HỦY</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )
            })
          )}
        </View>

        <View style={{ marginBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A' }}>LỊCH THI ĐẤU</Text>
            <TouchableOpacity onPress={handleCreateAllMatches} style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}><Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#0F6E56' }}>⚡ TẠO LỊCH TỰ ĐỘNG</Text></TouchableOpacity>
          </View>
          <View style={{ gap: 12 }}>
            {teamIds.map((tA, idx) => teamIds.slice(idx + 1).map(tB => (
              activeMatches.some(m => (m.team_a_no === Number(tA) && m.team_b_no === Number(tB)) || (m.team_a_no === Number(tB) && m.team_b_no === Number(tA))) ? null : (
                <View key={`${tA}-${tB}`} style={{ 
                  backgroundColor: '#F5F1E8', 
                  borderRadius: RADIUS.lg, 
                  marginBottom: 10,
                  borderWidth: 1, 
                  borderColor: '#E5E3DC',
                  overflow: 'hidden'
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      {/* Team A Info */}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>ĐỘI {tA}</Text>
                          <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADIUS.xs }}>
                            <Text style={{ fontSize: 9, color: '#0F6E56', fontWeight: '800' }}>{getTeamSkill(Number(tA)).toFixed(2)}</Text>
                          </View>
                        </View>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884' }} numberOfLines={1}>
                          {getPlayerNames(Number(tA))}
                        </Text>
                      </View>
                      
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#B4B2A9', marginHorizontal: 10 }}>VS</Text>
                      
                      {/* Team B Info */}
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADIUS.xs }}>
                            <Text style={{ fontSize: 9, color: '#0F6E56', fontWeight: '800' }}>{getTeamSkill(Number(tB)).toFixed(2)}</Text>
                          </View>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>ĐỘI {tB}</Text>
                        </View>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', textAlign: 'right' }} numberOfLines={1}>
                          {getPlayerNames(Number(tB))}
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity 
                      onPress={() => handleCreateMatch(Number(tA), Number(tB))} 
                      disabled={submitting} 
                      style={{ 
                        backgroundColor: '#0F6E56', 
                        paddingHorizontal: 12, 
                        paddingVertical: 8, 
                        borderRadius: RADIUS.md,
                        marginLeft: 12,
                        shadowColor: '#0F6E56',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.2,
                        shadowRadius: 4
                      }}
                    >
                      <Text style={{ color: 'white', fontSize: 11, fontFamily: SCREEN_FONTS.headline, fontWeight: '800' }}>BẮT ĐẦU</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            )))}
          </View>
        </View>

        {historyMatches.length > 0 && (
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', marginBottom: 16 }}>LỊCH SỬ TRẬN ĐẤU</Text>
            {historyMatches.map(match => {
              const isCancelled = match.status === 'cancelled'
              const winner = match.score_a > match.score_b ? 'a' : match.score_b > match.score_a ? 'b' : 'draw'

              return (
                <View key={match.id} style={{ 
                  backgroundColor: '#FFFFFF', 
                  borderRadius: RADIUS.lg, 
                  padding: 10,
                  marginBottom: 8,
                  borderWidth: 1, 
                  borderColor: '#E5E3DC', 
                  ...LAYOUT_SHADOW.xs,
                  opacity: isCancelled ? 0.7 : 1
                }}>
                  {/* Header: Time & Status */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#B4B2A9', fontWeight: '600' }}>
                      {new Date(match.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <View style={{ 
                      backgroundColor: isCancelled ? '#FDECEA' : '#E1F5EE', 
                      paddingHorizontal: 8, 
                      paddingVertical: 2, 
                      borderRadius: RADIUS.xs 
                    }}>
                      <Text style={{ 
                        fontSize: 8, 
                        fontWeight: '800', 
                        color: isCancelled ? '#D85A30' : '#0F6E56',
                        fontFamily: SCREEN_FONTS.headline,
                        letterSpacing: 0.5
                      }}>
                        {isCancelled ? 'ĐÃ HỦY' : 'HOÀN THÀNH'}
                      </Text>
                    </View>
                  </View>

                  {/* Body: Teams & Scores */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Team A */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ 
                        fontFamily: SCREEN_FONTS.headline, 
                        fontSize: 12, 
                        color: winner === 'a' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                        fontWeight: '800'
                      }}>ĐỘI {match.team_a_no}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginTop: 1 }} numberOfLines={1}>
                        {getPlayerNames(match.team_a_no)}
                      </Text>
                    </View>

                    {/* Compact Scoreboard */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
                      <View style={{ 
                        backgroundColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#F5F1E8', 
                        width: 28, height: 32, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: winner === 'a' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_a}</Text>
                      </View>
                      
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#B4B2A9' }}>—</Text>
                      
                      <View style={{ 
                        backgroundColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#F5F1E8', 
                        width: 28, height: 32, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: winner === 'b' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_b}</Text>
                      </View>
                    </View>

                    {/* Team B */}
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={{ 
                        fontFamily: SCREEN_FONTS.headline, 
                        fontSize: 12, 
                        color: winner === 'b' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                        fontWeight: '800',
                        textAlign: 'right'
                      }}>ĐỘI {match.team_b_no}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginTop: 1, textAlign: 'right' }} numberOfLines={1}>
                        {getPlayerNames(match.team_b_no)}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        )}
        <BrandedFooter />
      </ScrollView>
    </View>
  )
}
