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
  isAfterEnd?: boolean
}

type PendingMatch = { teamA: string[], teamB: string[] }

export function HostMatchScreen({ sessionId, matches, players, onUpdated, isAfterEnd }: Omit<Props, 'onClose'>) {
  const theme = useAppTheme()
  const [submitting, setSubmitting] = useState(false)
  const [isMixInMode, setIsMixInMode] = useState(true)
  const [showAllProgress, setShowAllProgress] = useState(false)
  const [pendingMixInMatches, setPendingMixInMatches] = useState<PendingMatch[]>([])
  const [sittingOutPlayers, setSittingOutPlayers] = useState<string[]>([]) // player IDs sitting out
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

  // --- Mix-in rotation completion check ---
  // Build a map: playerA -> Set of playerIds they've shared a match with
  const metMap = new Map<string, Set<string>>()
  const activePlayers = players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show')
  activePlayers.forEach(p => metMap.set(p.id, new Set()))

  const finishedMatches = matches.filter(m => m.status === 'finished')
  finishedMatches.forEach(m => {
    const snapshot = m.players_snapshot
    const teamA: string[] = snapshot?.team_a || []
    const teamB: string[] = snapshot?.team_b || []
    // Only count cross-team encounters (opponents), NOT same-team partners
    teamA.forEach(pid => {
      teamB.forEach(opponent => {
        if (metMap.has(pid)) metMap.get(pid)!.add(opponent)
        if (metMap.has(opponent)) metMap.get(opponent)!.add(pid)
      })
    })
  })

  const totalPlayers = activePlayers.length
  const isRotationComplete = totalPlayers >= 2 && activePlayers.every(p => {
    const met = metMap.get(p.id)
    return met && met.size >= totalPlayers - 1
  })

  // Player with fewest encounters (for progress tracking)
  const playerEncounterCounts = activePlayers.map(p => ({
    id: p.id,
    name: p.name,
    met: metMap.get(p.id)?.size ?? 0
  })).sort((a, b) => a.met - b.met)

  const handleUpdateScore = async (matchId: string, team: 'a' | 'b', delta: number) => {
    if (isAfterEnd) return
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
    if (isAfterEnd) return
    setSubmitting(true)
    const { error } = await supabase
      .from('session_matches')
      .update({ status: 'finished', updated_at: new Date().toISOString() })
      .eq('id', matchId)
    
    setSubmitting(false)
    if (!error) onUpdated()
  }

  const handleCancelMatch = async (matchId: string) => {
    if (isAfterEnd) return
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

  const getMatchFormat = (tANo: number, tBNo: number) => {
    const pA = teamGroups[String(tANo)] || []
    const pB = teamGroups[String(tBNo)] || []
    const all = [...pA, ...pB]
    const males = all.filter(p => String(p.gender || '').toLowerCase() === 'male' || String(p.gender || '').toLowerCase() === 'nam').length
    const females = all.filter(p => String(p.gender || '').toLowerCase() === 'female' || String(p.gender || '').toLowerCase() === 'nữ').length
    
    if (males === 4) return '4M'
    if (females === 4) return '4F'
    if (males === 2 && females === 2) return '2M2F'
    return 'OTHER'
  }

  const handleCreateMatch = async (teamA: number, teamB: number) => {
    if (isAfterEnd) return
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
    if (isAfterEnd) return
    const schedulingTeams = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, '0']
    const numRounds = schedulingTeams.length - 1
    const message = `Tạo lịch thi đấu tự động cho tất cả các đội? Hệ thống sẽ ưu tiên xáo trộn để đa dạng hóa các trận Nam/Nữ/Mixed.`
    
    const performCreate = async () => {
      setSubmitting(true)
      
      // 1. Generate all match pairings using Circle Method
      const matchPool: { tA: number, tB: number, format: string }[] = []
      const currentTeams = [...schedulingTeams]
      
      for (let round = 0; round < numRounds; round++) {
        for (let i = 0; i < currentTeams.length / 2; i++) {
          const tA = Number(currentTeams[i])
          const tB = Number(currentTeams[currentTeams.length - 1 - i])
          if (tA !== 0 && tB !== 0) {
            matchPool.push({ tA, tB, format: getMatchFormat(tA, tB) })
          }
        }
        // Rotate
        const last = currentTeams.pop()!
        currentTeams.splice(1, 0, last)
      }

      // 2. Diversity Sort: Re-order matches to avoid consecutive/simultaneous formats
      const finalSchedule: typeof matchPool = []
      const remainingMatches = [...matchPool]
      let lastFormats: string[] = [] // Keep track of the last few formats (to handle multi-court)
      const maxHistory = Math.max(2, (players.length / 4)) // Roughly the number of concurrent matches possible

      while (remainingMatches.length > 0) {
        // Find a match that hasn't appeared recently
        let bestIdx = remainingMatches.findIndex(m => !lastFormats.includes(m.format))
        if (bestIdx === -1) bestIdx = 0 // Fallback to first if all formats recently used

        const picked = remainingMatches.splice(bestIdx, 1)[0]
        finalSchedule.push(picked)
        
        lastFormats.push(picked.format)
        if (lastFormats.length > maxHistory) lastFormats.shift()
      }

      // 3. Batch Insert into Supabase
      const insertData = finalSchedule.map(m => ({
        session_id: sessionId,
        team_a_no: m.tA,
        team_b_no: m.tB,
        status: 'playing',
        players_snapshot: {
          team_a: teamGroups[String(m.tA)]?.map(p => p.id),
          team_b: teamGroups[String(m.tB)]?.map(p => p.id)
        }
      }))

      const { error } = await supabase.from('session_matches').insert(insertData)
      
      if (error) {
        console.error('[CreateAllMatches] Error:', error)
        Alert.alert('Lỗi', 'Không thể tạo lịch thi đấu tự động.')
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

  const getMatchPlayerNames = (snapshotUids: string[]) => {
    if (!snapshotUids || snapshotUids.length === 0) return 'Đang cập nhật'
    return snapshotUids.map(uid => players.find(p => p.id === uid)?.name || 'Người chơi').join(' & ')
  }

  const handleGenerateMixInRound = () => {
    if (isAfterEnd) return
    const eligible = [...players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show')]
    if (eligible.length < 4) {
      Alert.alert('Chưa đủ người', 'Cần ít nhất 4 người để bốc thăm thi đấu.')
      return
    }

    // Count total matches played + last match timestamp per player.
    // Using match COUNT (not creation index) avoids bias where players in the
    // "last created match" of a round get unfairly deprioritized next round.
    const matchesPlayed = new Map<string, number>()
    const lastMatchTime = new Map<string, number>()
    eligible.forEach(p => { matchesPlayed.set(p.id, 0); lastMatchTime.set(p.id, 0) })

    matches.forEach(m => {
      const all = [...(m.players_snapshot?.team_a || []), ...(m.players_snapshot?.team_b || [])]
      const t = new Date(m.created_at).getTime()
      all.forEach(pid => {
        if (matchesPlayed.has(pid)) {
          matchesPlayed.set(pid, (matchesPlayed.get(pid) ?? 0) + 1)
          lastMatchTime.set(pid, Math.max(lastMatchTime.get(pid) ?? 0, t))
        }
      })
    })

    // Sort: 1) fewer matches played → higher priority; 2) rested longer → higher priority
    const sorted = [...eligible].sort((a, b) => {
      const aPlayed = matchesPlayed.get(a.id) ?? 0
      const bPlayed = matchesPlayed.get(b.id) ?? 0
      if (aPlayed !== bPlayed) return aPlayed - bPlayed
      return (lastMatchTime.get(a.id) ?? 0) - (lastMatchTime.get(b.id) ?? 0)
    })

    const numMatches = Math.floor(sorted.length / 4)
    const playing = sorted.slice(0, numMatches * 4)
    playing.sort(() => Math.random() - 0.5) // randomize pairings within eligible group

    const proposals: PendingMatch[] = []
    for (let i = 0; i < numMatches; i++) {
      proposals.push({
        teamA: [playing[i * 4].id, playing[i * 4 + 1].id],
        teamB: [playing[i * 4 + 2].id, playing[i * 4 + 3].id],
      })
    }
    const sittingOut = sorted.slice(numMatches * 4).map(p => p.id)
    setPendingMixInMatches(proposals)
    setSittingOutPlayers(sittingOut)
  }

  const handleConfirmMixInMatch = async (match: PendingMatch) => {
    setSubmitting(true)
    const { error } = await supabase.from('session_matches').insert({
      session_id: sessionId,
      team_a_no: 0,
      team_b_no: 0,
      status: 'playing',
      players_snapshot: { team_a: match.teamA, team_b: match.teamB }
    })
    setSubmitting(false)
    if (error) {
      Alert.alert('Lỗi', 'Không thể bắt đầu trận đấu')
    } else {
      setPendingMixInMatches(prev => prev.filter(m => m.teamA !== match.teamA || m.teamB !== match.teamB))
      onUpdated()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {__DEV__ && (
          <TouchableOpacity
            onPress={async () => {
              try {
                const { error } = await supabase.from('session_matches').delete().eq('session_id', sessionId)
                if (error) throw error
                onUpdated()
                if (Platform.OS === 'web') window.alert('Đã xóa toàn bộ lịch sử trận.')
                else Alert.alert('OK', 'Đã xóa toàn bộ lịch sử trận.')
              } catch (e: any) {
                Alert.alert('Lỗi', e.message)
              }
            }}
            style={{
              alignSelf: 'flex-end', marginBottom: 8,
              paddingHorizontal: 8, paddingVertical: 4,
              backgroundColor: '#fee2e2', borderRadius: 4,
              borderWidth: 1, borderColor: '#fca5a5'
            }}
          >
            <Text style={{ fontSize: 10, color: '#dc2626', fontWeight: '700' }}>🗑 RESET TRẬN</Text>
          </TouchableOpacity>
        )}
        {!isAfterEnd && (
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
                Vui lòng chọn cặp đấu bên dưới để {`"lên sóng"`}
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      
                      {/* Team A Section */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'a', -1)} 
                            disabled={isAfterEnd}
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center', 
                              borderWidth: 1, borderColor: '#E5E3DC',
                              opacity: (pressed || isAfterEnd) ? 0.7 : 1
                            })}
                          >
                            <Minus size={18} color="#7A8884" />
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
                            onPress={() => handleUpdateScore(match.id, 'a', 1)} 
                            disabled={isAfterEnd}
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: isAfterEnd ? '#E5E3DC' : '#0F6E56', alignItems: 'center', justifyContent: 'center', 
                              ...LAYOUT_SHADOW.sm,
                              opacity: (pressed || isAfterEnd) ? 0.8 : 1
                            })}
                          >
                            <Plus size={18} color="white" />
                          </Pressable>
                        </View>
                        {match.team_a_no === 0 ? (
                          <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 8, textAlign: 'center', fontWeight: '700', lineHeight: 18 }}>
                            {getMatchPlayerNames(match.players_snapshot?.team_a || [])}
                          </Text>
                        ) : (
                          <>
                            <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 6, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_a_no}</Text>
                            <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_a_no)}</Text>
                          </>
                        )}
                      </View>

                      {/* VS Divider */}
                      <View style={{ paddingHorizontal: 10, alignItems: 'center' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#B4B2A9', fontWeight: '900' }}>VS</Text>
                      </View>

                      {/* Team B Section */}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Pressable 
                            onPress={() => handleUpdateScore(match.id, 'b', -1)} 
                            disabled={isAfterEnd}
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center', 
                              borderWidth: 1, borderColor: '#E5E3DC',
                              opacity: (pressed || isAfterEnd) ? 0.7 : 1
                            })}
                          >
                            <Minus size={18} color="#7A8884" />
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
                            onPress={() => handleUpdateScore(match.id, 'b', 1)} 
                            disabled={isAfterEnd}
                            style={({ pressed }) => ({ 
                              width: 36, height: 36, borderRadius: 18, 
                              backgroundColor: isAfterEnd ? '#E5E3DC' : '#0F6E56', alignItems: 'center', justifyContent: 'center', 
                              ...LAYOUT_SHADOW.sm,
                              opacity: (pressed || isAfterEnd) ? 0.8 : 1
                            })}
                          >
                            <Plus size={18} color="white" />
                          </Pressable>
                        </View>
                        {match.team_b_no === 0 ? (
                          <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 8, textAlign: 'center', fontWeight: '700', lineHeight: 18 }}>
                            {getMatchPlayerNames(match.players_snapshot?.team_b || [])}
                          </Text>
                        ) : (
                          <>
                            <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 6, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_b_no}</Text>
                            <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_b_no)}</Text>
                          </>
                        )}
                      </View>
                    </View>

                    {/* Bottom Actions */}
                    {!isAfterEnd && (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
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
                    )}
                  </View>
                </View>
              )
            })
          )}
        </View>
        )}

        {/* Pending Proposals Preview — shown above tabs when proposals exist */}
        {!isAfterEnd && pendingMixInMatches.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A' }}>
                LƯỢT TRẬN ĐỀ XUẤT
              </Text>
              <TouchableOpacity onPress={() => { setPendingMixInMatches([]); setSittingOutPlayers([]) }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884' }}>Xóa tất cả</Text>
              </TouchableOpacity>
            </View>

            {/* Sitting out notice */}
            {sittingOutPlayers.length > 0 && (
              <View style={{ backgroundColor: '#FEF9EE', borderRadius: RADIUS.md, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#F5DFA0', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ fontSize: 14 }}>⏸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#854F0B', marginBottom: 4 }}>
                    NGỒI CHỜ LƯỢT NÀY ({sittingOutPlayers.length} người)
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', lineHeight: 16 }}>
                    {sittingOutPlayers.map(pid => players.find(p => p.id === pid)?.name || pid).join(' · ')}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', marginTop: 4 }}>
                    Họ sẽ được ưu tiên chơi ở lượt tiếp theo.
                  </Text>
                </View>
              </View>
            )}
            {pendingMixInMatches.map((match, idx) => {
              const teamAPlayers = match.teamA.map(pid => players.find(p => p.id === pid))
              const teamBPlayers = match.teamB.map(pid => players.find(p => p.id === pid))
              return (
                <View key={idx} style={{
                  backgroundColor: '#F5F1E8',
                  borderRadius: RADIUS.lg,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: '#E5E3DC',
                  overflow: 'hidden'
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      {/* CẶP 1 */}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginBottom: 3 }}>CẶP 1</Text>
                        {teamAPlayers.map((p, i) => (
                          <Text key={i} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }} numberOfLines={1}>
                            {p?.name || 'Người chơi'}
                          </Text>
                        ))}
                      </View>

                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#B4B2A9', marginHorizontal: 10 }}>VS</Text>

                      {/* CẶP 2 */}
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginBottom: 3 }}>CẶP 2</Text>
                        {teamBPlayers.map((p, i) => (
                          <Text key={i} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800', textAlign: 'right' }} numberOfLines={1}>
                            {p?.name || 'Người chơi'}
                          </Text>
                        ))}
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleConfirmMixInMatch(match)}
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
                        shadowRadius: 4,
                        opacity: submitting ? 0.7 : 1
                      }}
                    >
                      <Text style={{ color: 'white', fontSize: 11, fontFamily: SCREEN_FONTS.headline, fontWeight: '800' }}>BẮT ĐẦU</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}
          </View>
        )}

        {/* Toggle Mode */}
        {!isAfterEnd && (
          <View style={{ flexDirection: 'row', backgroundColor: '#F5F1E8', borderRadius: RADIUS.lg, padding: 4, marginBottom: 24 }}>
            <TouchableOpacity 
              onPress={() => setIsMixInMode(true)}
              style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: isMixInMode ? 'white' : 'transparent', borderRadius: RADIUS.md, ...(isMixInMode ? LAYOUT_SHADOW.sm : {}) }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: isMixInMode ? '#0F6E56' : '#7A8884' }}>ĐỔI CẶP (MIX-IN)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setIsMixInMode(false)}
              style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: !isMixInMode ? 'white' : 'transparent', borderRadius: RADIUS.md, ...(!isMixInMode ? LAYOUT_SHADOW.sm : {}) }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: !isMixInMode ? '#0F6E56' : '#7A8884' }}>CỐ ĐỊNH (CÁC ĐỘI)</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Mix-In UI */}
        {!isAfterEnd && isMixInMode && (
          <View style={{ marginBottom: 32 }}>
            {/* Rotation Complete Banner */}
            {isRotationComplete && (
              <View style={{ 
                backgroundColor: '#0F6E56', 
                padding: 16, 
                borderRadius: RADIUS.xl, 
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12
              }}>
                <Text style={{ fontSize: 24 }}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '800' }}>
                    VÒNG XOAY HOÀN TẤT!
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#E1F5EE', marginTop: 2 }}>
                    Mọi người đã được đấu cùng nhau ít nhất 1 lần. Có thể tiếp tục thêm lượt hoặc kết thúc buổi đấu.
                  </Text>
                </View>
              </View>
            )}

            {/* Progress: Who hasn't met everyone yet */}
            {!isRotationComplete && finishedMatches.length > 0 && totalPlayers >= 4 && (
              <View style={{ backgroundColor: '#F5F1E8', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#7A8884', marginBottom: 8, letterSpacing: 0.5 }}>
                  TIẾN ĐỘ XOAY VÒNG
                </Text>
                {(showAllProgress ? playerEncounterCounts : playerEncounterCounts.slice(0, 4)).map(({ id, name, met }) => (
                  <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#1A2E2A', fontWeight: '600', flex: 1 }}>{name}</Text>
                    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {Array.from({ length: totalPlayers - 1 }).map((_, i) => (
                        <View
                          key={i}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: i < met ? '#0F6E56' : '#E5E3DC',
                            borderWidth: 1,
                            borderColor: i < met ? '#0F6E56' : '#C8C4BA',
                          }}
                        />
                      ))}
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: met >= totalPlayers - 1 ? '#0F6E56' : '#854F0B', width: 28, textAlign: 'right' }}>
                      {met}/{totalPlayers - 1}
                    </Text>
                  </View>
                ))}
                {playerEncounterCounts.length > 4 && (
                  <TouchableOpacity onPress={() => setShowAllProgress(p => !p)} style={{ marginTop: 4, alignItems: 'center', paddingVertical: 4 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56' }}>
                      {showAllProgress ? '▲ Thu gọn' : `▼ Xem tất cả (${playerEncounterCounts.length} người)`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}


            {/* One-Click Button */}
            <View style={{ alignItems: 'center', backgroundColor: 'white', padding: 24, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: '#E5E3DC', borderStyle: 'dashed' }}>
              <SwordsIcon size={32} color="#0F6E56" style={{ marginBottom: 12, opacity: 0.3 }} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', marginBottom: 6, textAlign: 'center' }}>
                {isRotationComplete ? 'TIẾP TỤC LƯỢT MỚI' : 'CHẾ ĐỘ ĐỔI CẶP'}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884', textAlign: 'center', marginBottom: 20, paddingHorizontal: 8 }}>
                {isRotationComplete 
                  ? 'Tất cả mọi người đã đấu với nhau rồi! Tiếp tục để bắt đầu vòng mới.'
                  : 'Bốc thăm ngẫu nhiên cặp mới cho tất cả người chơi đang rảnh.'}
              </Text>
              <TouchableOpacity 
                onPress={handleGenerateMixInRound}
                disabled={submitting}
                style={{ backgroundColor: '#0F6E56', paddingHorizontal: 24, paddingVertical: 14, borderRadius: RADIUS.lg, width: '100%', alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
              >
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 14, fontWeight: '800' }}>
                  {pendingMixInMatches.length > 0 ? 'BỐC THĂM LẠI' : 'TẠO LƯỢT TRẬN MỚI (ONE-CLICK)'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isAfterEnd && !isMixInMode && (
          <View style={{ marginBottom: 32 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A' }}>LỊCH THI ĐẤU</Text>
              {(() => {
                const confirmedCount = players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show').length
                const isOdd = confirmedCount % 2 !== 0
                return (
                  <TouchableOpacity
                    onPress={isOdd ? undefined : handleCreateAllMatches}
                    disabled={isOdd}
                    style={{ backgroundColor: isOdd ? '#F0EDE6' : '#E1F5EE', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, opacity: isOdd ? 0.6 : 1 }}
                  >
                    <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: isOdd ? '#B4B2A9' : '#0F6E56' }}>
                      {isOdd ? '⚠ SỐ NGƯỜI LẺ' : '⚡ TẠO LỊCH TỰ ĐỘNG'}
                    </Text>
                  </TouchableOpacity>
                )
              })()}
            </View>

            {/* Odd player warning */}
            {players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show').length % 2 !== 0 && (
              <View style={{ backgroundColor: '#FEF9EE', borderRadius: RADIUS.md, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#F5DFA0' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#854F0B', marginBottom: 4 }}>
                  ⚠ Không thể tạo lịch cố định khi số người lẻ
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', lineHeight: 16 }}>
                  Chế độ cố định cặp cần số người chẵn để xếp đội 2 người. Hãy chờ thêm người check-in, hoặc chuyển sang{' '}
                  <Text style={{ color: '#0F6E56', fontWeight: '700' }} onPress={() => setIsMixInMode(true)}>
                    Đổi Cặp (Mix-In)
                  </Text>
                  {' '}để xử lý số người lẻ tốt hơn.
                </Text>
              </View>
            )}

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
        )}

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
                      {match.team_a_no === 0 ? (
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 12, 
                          color: winner === 'a' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                          fontWeight: '700',
                          lineHeight: 18
                        }}>{getMatchPlayerNames(match.players_snapshot?.team_a || [])}</Text>
                      ) : (
                        <>
                          <Text style={{ 
                            fontFamily: SCREEN_FONTS.headline, 
                            fontSize: 14, 
                            color: winner === 'a' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                            fontWeight: '800'
                          }}>ĐỘI {match.team_a_no}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2 }} numberOfLines={1}>
                            {getPlayerNames(match.team_a_no)}
                          </Text>
                        </>
                      )}
                    </View>

                    {/* Compact Scoreboard */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
                      <View style={{ 
                        backgroundColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#F5F1E8', 
                        width: 34, height: 40, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: winner === 'a' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_a}</Text>
                      </View>
                      
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#B4B2A9' }}>—</Text>
                      
                      <View style={{ 
                        backgroundColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#F5F1E8', 
                        width: 34, height: 40, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: winner === 'b' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_b}</Text>
                      </View>
                    </View>

                    {/* Team B */}
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      {match.team_b_no === 0 ? (
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 12, 
                          color: winner === 'b' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                          fontWeight: '700',
                          textAlign: 'right',
                          lineHeight: 18
                        }}>{getMatchPlayerNames(match.players_snapshot?.team_b || [])}</Text>
                      ) : (
                        <>
                          <Text style={{ 
                            fontFamily: SCREEN_FONTS.headline, 
                            fontSize: 14, 
                            color: winner === 'b' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                            fontWeight: '800',
                            textAlign: 'right'
                          }}>ĐỘI {match.team_b_no}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2, textAlign: 'right' }} numberOfLines={1}>
                            {getPlayerNames(match.team_b_no)}
                          </Text>
                        </>
                      )}
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
