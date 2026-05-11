import React, { useState } from 'react'
import { Text, View, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { RefreshCw, ShieldCheck } from 'lucide-react-native'
import { getInitials, type ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { BrandedFooter } from '@/components/design/BrandedFooter'

type Props = {
  onClose: () => void
  players: ArrangementPlayer[]
  maxPlayers: number
  sessionId: string
  onUpdated: () => void
  onGoToMatches?: () => void
  isAfterEnd?: boolean
}

export function TeamArrangementScreen({ onClose, players, maxPlayers, sessionId, onUpdated, onGoToMatches, isAfterEnd }: Props) {
  const theme = useAppTheme()
  const [arrangedPlayers, setArrangedPlayers] = useState<ArrangementPlayer[]>(players)
  const [submitting, setSubmitting] = useState(false)
  const [targetNumTeams, setTargetNumTeams] = useState(Math.max(2, Math.ceil(players.length / 2)))
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)
  const [hasOngoingMatches, setHasOngoingMatches] = useState(false)
  const [checkingMatches, setCheckingMatches] = useState(false)
  const [keepPartners, setKeepPartners] = useState(false)

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

    setArrangedPlayers(players)
    setTargetNumTeams(Math.max(2, Math.ceil(players.length / 2)))
    checkOngoing()
  }, [players, sessionId])

  const teamOptions = Array.from({ length: targetNumTeams }, (_, i) => i + 1)

  const calculateTotalSatisfaction = (currentPlayers: ArrangementPlayer[]) => {
    let score = 0
    const teams = new Map<number, ArrangementPlayer[]>()
    currentPlayers.forEach(p => {
      if (p.team > 0) {
        if (!teams.has(p.team)) teams.set(p.team, [])
        teams.get(p.team)!.push(p)
      }
    })

    currentPlayers.forEach(p => {
      if (p.team <= 0) return
      const partner = teams.get(p.team)?.find(o => o.id !== p.id)
      const opponents = currentPlayers.filter(o => o.team > 0 && o.team !== p.team)

      // Partner Preference
      if (p.metadata?.partner_gender_pref && p.metadata.partner_gender_pref !== 'any' && partner) {
        const partnerGender = String(partner.gender || '').toLowerCase()
        const pref = p.metadata.partner_gender_pref
        if ((pref === 'female' && (partnerGender === 'female' || partnerGender === 'nữ')) ||
            (pref === 'male' && (partnerGender === 'male' || partnerGender === 'nam'))) {
          score += 10
        }
      }

      // Opponent Preference
      if (p.metadata?.opponent_gender_pref && p.metadata.opponent_gender_pref !== 'any' && opponents.length > 0) {
        const pref = p.metadata.opponent_gender_pref
        const matchedOpponent = opponents.some(o => {
          const oGender = String(o.gender || '').toLowerCase()
          return (pref === 'female' && (oGender === 'female' || oGender === 'nữ')) ||
                 (pref === 'male' && (oGender === 'male' || oGender === 'nam'))
        })
        if (matchedOpponent) score += 5
      }
    })
    return score
  }

  const autoBalanceTeams = () => {
    if (keepPartners) {
      // MODE: Keep existing partners but re-assign teams to balance match difficulty
      const teamsMap = new Map<number, ArrangementPlayer[]>()
      arrangedPlayers.forEach(p => {
        if (p.team > 0) {
          if (!teamsMap.has(p.team)) teamsMap.set(p.team, [])
          teamsMap.get(p.team)!.push(p)
        }
      })
      
      const existingTeams = Array.from(teamsMap.values()).map(players => ({
        players,
        avgElo: players.reduce((acc, p) => acc + (p.pvna || 0), 0) / players.length
      }))
      
      const waitingPlayers = arrangedPlayers.filter(p => p.team <= 0)
      if (isAfterEnd) return
      
      // Shuffle and then pick best of several tries
      let bestResult: ArrangementPlayer[] = []
      let bestScore = -1

      for (let round = 0; round < 20; round++) {
        let currentTry: ArrangementPlayer[] = []
        const shuffledTeams = [...existingTeams].sort(() => Math.random() - 0.5)
        
        shuffledTeams.forEach((t, idx) => {
          const newTeamNo = idx + 1
          t.players.forEach(p => {
            currentTry.push({ ...p, team: newTeamNo <= targetNumTeams ? newTeamNo : 0 })
          })
        })
        waitingPlayers.forEach(p => currentTry.push({ ...p, team: 0 }))

        const currentScore = calculateTotalSatisfaction(currentTry)
        // Also consider skill balance between opponents in matches (T1 vs T2, T3 vs T4)
        let skillBalancePenalty = 0
        for (let i = 1; i < targetNumTeams; i += 2) {
          const t1 = shuffledTeams[i-1]
          const t2 = shuffledTeams[i]
          if (t1 && t2) {
            skillBalancePenalty += Math.abs(t1.avgElo - t2.avgElo) * 10
          }
        }

        const finalScore = currentScore - skillBalancePenalty
        if (finalScore > bestScore) {
          bestScore = finalScore
          bestResult = currentTry
        }
      }
      
      setArrangedPlayers(bestResult)
      return
    }

    // MODE: Change partners (Traditional Auto-balance)
    if (isAfterEnd) return
    // 1. Initial Skill-based Balance (Greedy Snake/High-Low)
    const sorted = [...arrangedPlayers].sort((a, b) => {
      const valA = a.pvna ?? (a.elo / 100)
      const valB = b.pvna ?? (b.elo / 100)
      return valB - valA
    })

    let initialResult: ArrangementPlayer[] = []
    const playersPerTeam = 2 
    let left = 0
    let right = sorted.length - 1
    const used = new Set()
    
    for (let t = 1; t <= targetNumTeams; t++) {
      for (let i = 0; i < playersPerTeam; i++) {
        if (used.size >= sorted.length) break
        let pickedIdx = -1
        if (i % 2 === 0) {
          while (left < sorted.length && used.has(sorted[left].id)) left++
          if (left < sorted.length) pickedIdx = left
        } else {
          while (right >= 0 && used.has(sorted[right].id)) right--
          if (right >= 0 && right >= left) pickedIdx = right
        }
        if (pickedIdx !== -1) {
          const p = sorted[pickedIdx]
          initialResult.push({ ...p, team: t })
          used.add(p.id)
        }
      }
    }
    sorted.forEach(p => { if (!used.has(p.id)) initialResult.push({ ...p, team: 0 }) })

    // 2. Optimization Phase: Smart Randomized Swapping
    // Instead of picking the absolute best, we try many combinations and pick one that is 
    // "Great" (High satisfaction + Good balance) but potentially different each time.
    let candidates: { players: ArrangementPlayer[], score: number }[] = []
    
    for (let round = 0; round < 50; round++) {
      let currentTry = round === 0 ? [...initialResult] : [...initialResult].sort(() => Math.random() - 0.5)
      
      // If not the first round, do a quick skill-based re-assignment
      if (round > 0) {
        const tempUsed = new Set()
        let tempResult: ArrangementPlayer[] = []
        const currentSorted = [...currentTry].sort((a, b) => (b.pvna || 0) - (a.pvna || 0))
        
        // Simple assignment
        let tNo = 1
        let pCount = 0
        currentSorted.forEach(p => {
          if (tNo <= targetNumTeams) {
            tempResult.push({ ...p, team: tNo })
            pCount++
            if (pCount >= 2) { tNo++; pCount = 0; }
          } else {
            tempResult.push({ ...p, team: 0 })
          }
        })
        currentTry = tempResult
      }

      // Small random swaps to improve satisfaction
      for (let swap = 0; swap < 10; swap++) {
        const idx1 = Math.floor(Math.random() * currentTry.length)
        const idx2 = Math.floor(Math.random() * currentTry.length)
        const p1 = currentTry[idx1]; const p2 = currentTry[idx2]
        
        if (p1.team > 0 && p2.team > 0 && p1.team !== p2.team) {
          const skillDiff = Math.abs((p1.pvna || 0) - (p2.pvna || 0))
          if (skillDiff <= 0.4) { // Tight skill constraint for balance
            const t1 = p1.team
            currentTry[idx1] = { ...p1, team: p2.team }
            currentTry[idx2] = { ...p2, team: t1 }
          }
        }
      }

      const score = calculateTotalSatisfaction(currentTry)
      candidates.push({ players: currentTry, score })
    }

    // Sort candidates by score and pick randomly from the top 5
    candidates.sort((a, b) => b.score - a.score)
    const bestCandidates = candidates.slice(0, 5)
    const finalPick = bestCandidates[Math.floor(Math.random() * bestCandidates.length)]
    
    setArrangedPlayers(finalPick.players)
  }

  const shuffleTeams = () => {
    if (isAfterEnd) return
    let result: ArrangementPlayer[] = []
    
    if (keepPartners) {
      // 1. Group existing teams
      const teamsMap = new Map<number, ArrangementPlayer[]>()
      arrangedPlayers.forEach(p => {
        if (p.team > 0) {
          if (!teamsMap.has(p.team)) teamsMap.set(p.team, [])
          teamsMap.get(p.team)!.push(p)
        }
      })
      
      const waitingPlayers = arrangedPlayers.filter(p => p.team <= 0)
      const existingTeams = Array.from(teamsMap.values())
      
      // 2. Shuffle the teams themselves
      const shuffledTeams = [...existingTeams].sort(() => Math.random() - 0.5)
      
      // 3. Assign to new team numbers while keeping members together
      shuffledTeams.forEach((teamPlayers, idx) => {
        const newTeamNo = idx + 1
        teamPlayers.forEach(p => {
          result.push({ ...p, team: newTeamNo <= targetNumTeams ? newTeamNo : 0 })
        })
      })
      
      // 4. Handle players who were waiting or don't fit in new team count
      waitingPlayers.forEach(p => {
        if (!result.find(rp => rp.id === p.id)) {
          result.push({ ...p, team: 0 })
        }
      })
    } else {
      // Standard shuffle (Change partners)
      const shuffled = [...arrangedPlayers].sort(() => Math.random() - 0.5)
      const playersPerTeam = 2
      
      result = shuffled.map((p, idx) => {
        const teamIdx = Math.floor(idx / playersPerTeam) + 1
        return {
          ...p,
          team: teamIdx <= targetNumTeams ? teamIdx : 0
        }
      })
    }

    setArrangedPlayers(result)
  }

  const totalPlayers = arrangedPlayers.length

  const handleSave = async () => {
    if (isAfterEnd) return
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
  const targetBalance = totalPlayers > 0 ? totalSkill / totalPlayers : 0
  const maxSkill = 6.0 

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
                {Array.from({ length: Math.max(0, totalPlayers - 1) }, (_, i) => i + 2).map(n => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setTargetNumTeams(n)}
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

          {/* Rotation Settings */}
          <View style={{ 
            flexDirection: 'row', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            backgroundColor: '#F5F1E8',
            padding: 12,
            borderRadius: 12,
            marginBottom: 16
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 18 }}>🔄</Text>
              <View>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '700' }}>Chế độ xoay vòng</Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884' }}>
                  {keepPartners ? 'Giữ nguyên các cặp đã ghép' : 'Đổi cặp ngẫu nhiên mỗi lượt'}
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              onPress={() => setKeepPartners(!keepPartners)}
              activeOpacity={0.8}
              style={{
                width: 50,
                height: 26,
                borderRadius: 13,
                backgroundColor: keepPartners ? '#0F6E56' : '#D5D2C8',
                padding: 2,
                justifyContent: 'center'
              }}
            >
              <View style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: 'white',
                alignSelf: keepPartners ? 'flex-end' : 'flex-start',
                ...LAYOUT_SHADOW.xs
              }} />
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
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
              }}>Chia thông minh</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={shuffleTeams}
              disabled={isAfterEnd}
              activeOpacity={0.7}
              style={{ 
                flex: 1,
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: 8, 
                backgroundColor: '#F5F1E8', 
                paddingVertical: 14, 
                borderRadius: 12,
                opacity: isAfterEnd ? 0.5 : 1
              }}
            >
              <RefreshCw size={16} color="#1A2E2A" />
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 13, 
                fontWeight: '700',
                color: '#1A2E2A',
                textTransform: 'uppercase'
              }}>Xáo ngẫu nhiên</Text>
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
              const teamAvg = ps.length > 0 ? teamSkill / ps.length : 0
              const balance = teamAvg - targetBalance
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
                          {teamAvg.toFixed(2)}
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
                          width: `${Math.min(100, (teamAvg / maxSkill) * 100)}%`, 
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
          onPress={handleSave}
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
            {submitting ? 'ĐANG LƯU...' : (isAfterEnd ? 'ĐÃ ĐÓNG' : 'Lưu sắp xếp')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
