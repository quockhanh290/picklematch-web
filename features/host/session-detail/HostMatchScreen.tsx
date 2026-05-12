import { BrandedFooter } from '@/components/design/BrandedFooter'
import { SHADOW as LAYOUT_SHADOW, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { SessionMatch } from '@/hooks/useSessionDetail'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { Minus, Plus, SwordsIcon } from 'lucide-react-native'
import React, { useState, useEffect, useMemo } from 'react'
import { Alert, Dimensions, Platform, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const IS_SMALL_DEVICE = SCREEN_WIDTH < 375
const RESPONSIVE_CARD_WIDTH = SCREEN_WIDTH > 400 ? 80 : SCREEN_WIDTH > 360 ? 70 : 64
const RESPONSIVE_CARD_HEIGHT = RESPONSIVE_CARD_WIDTH * 1.25
const RESPONSIVE_FONT_SIZE = SCREEN_WIDTH > 400 ? 56 : SCREEN_WIDTH > 360 ? 48 : 42
const RESPONSIVE_GAP = SCREEN_WIDTH > 360 ? 8 : 4

// Helper for combinations (needed for the fixed schedule)
function getCombos(arr: number[], k: number): number[][] {
  const res: number[][] = [], tmp: number[] = []
  function go(s: number) {
    if (tmp.length === k) { res.push([...tmp]); return }
    for (let i = s; i <= arr.length - (k - tmp.length); i++) {
      tmp.push(arr[i]); go(i + 1); tmp.pop()
    }
  }
  go(0)
  return res
}

interface Props {
  sessionId: string
  matches: SessionMatch[]
  players: ArrangementPlayer[]
  onUpdated: () => void
  onClose?: () => void
  isAfterEnd?: boolean
}

type PendingMatch = { 
  teamA: string[]
  teamB: string[]
  rotation?: number
  court?: number
  sitterId?: string
}

export function HostMatchScreen({ sessionId, matches, players, onUpdated, isAfterEnd }: Omit<Props, 'onClose'>) {
  const theme = useAppTheme()
  const [submitting, setSubmitting] = useState(false)
  const [isMixInMode, setIsMixInMode] = useState(true)
  const [showAllProgress, setShowAllProgress] = useState(false)
  const [showRotationTable, setShowRotationTable] = useState(false)
  const [pendingMixInMatches, setPendingMixInMatches] = useState<PendingMatch[]>([])
  const [fullRotationSchedule, setFullRotationSchedule] = useState<PendingMatch[]>([])
  const [scheduledPlayers, setScheduledPlayers] = useState<ArrangementPlayer[]>([])
  const [sittingOutPlayers, setSittingOutPlayers] = useState<string[]>([]) // player IDs sitting out
  const [localScores, setLocalScores] = useState<Record<string, { a: number, b: number }>>({})

  // Sync local scores when matches change, but carefully to avoid flickering
  useEffect(() => {
    const newScores: Record<string, { a: number, b: number }> = {}
    matches.forEach(m => {
      if (m.status === 'playing' || m.status === 'finished') {
        newScores[m.id] = { a: m.score_a || 0, b: m.score_b || 0 }
      }
    })
    setLocalScores(prev => {
      const hasChanged = Object.keys(newScores).some(id => 
        !prev[id] || prev[id].a !== newScores[id].a || prev[id].b !== newScores[id].b
      )
      return hasChanged ? newScores : prev
    })
  }, [matches])

  useEffect(() => {
    if (fullRotationSchedule.length === 0 && matches.some(m => m.players_snapshot?.rotation)) {
      const restored = matches
        .filter(m => m.players_snapshot?.rotation)
        .map(m => ({
          teamA: m.players_snapshot.team_a,
          teamB: m.players_snapshot.team_b,
          rotation: m.players_snapshot.rotation,
          court: m.players_snapshot.court,
          sitterId: m.players_snapshot.sitter_id
        }))
        .sort((a, b) => (a.rotation || 0) - (b.rotation || 0) || (a.court || 0) - (b.court || 0));
      if (restored.length > 0) {
        setFullRotationSchedule(restored);
        // Also ensure scheduledPlayers is populated
        const allIds = new Set<string>();
        restored.forEach(r => {
          r.teamA.forEach((id: string) => allIds.add(id));
          r.teamB.forEach((id: string) => allIds.add(id));
          if (r.sitterId) r.sitterId.split(',').forEach((id: string) => allIds.add(id));
        });
        const stableList = players
          .filter(p => allIds.has(String(p.id)))
          .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
        setScheduledPlayers(stableList);
      }
    }
  }, [matches, fullRotationSchedule.length, players]);

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

  const activePlayers = players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show')

  const getMatchPlayerNames = (snapshotUids: string[]) => {
    if (!snapshotUids || snapshotUids.length === 0) return 'Đang cập nhật'
    return snapshotUids
      .map(uid => players.find(p => p.id === uid)?.name || 'Người chơi')
      .sort((a, b) => a.localeCompare(b))
      .join(' & ')
  }

  // --- EXACT ALGORITHM FROM roundrobin13.jsx ---
  const handleGenerateFixedSchedule = () => {
    const X = activePlayers.length;
    if (X < 4) {
      const msg = `Cần ít nhất 4 người để tạo lịch (hiện có ${X}).`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Yêu cầu thêm người', msg);
      return;
    }

    const performGeneration = () => {
      try {
        setSubmitting(true);
        // Simple sort by name, but use ID as hidden tie-breaker for absolute stability
        const sortedPlayers = [...activePlayers].sort((a, b) => 
          a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))
        );
        setScheduledPlayers(sortedPlayers);
        
        const pIds = sortedPlayers.map(p => String(p.id));
        const X = sortedPlayers.length;
        const playersIdx = [...Array(X).keys()];
        const pm: any = {};
        const om: any = {};
        const sitCnt: any = Object.fromEntries(playersIdx.map(p => [p, 0]));
        const gamesCnt: any = Object.fromEntries(playersIdx.map(p => [p, 0]));
        const schedule: PendingMatch[] = [];

        const pk = (a: number, b: number) => a < b ? `${a}_${b}` : `${b}_${a}`;
        const gv = (m: any, a: number, b: number) => m[pk(a, b)] || 0;
        const inc = (m: any, a: number, b: number) => { const k = pk(a, b); m[k] = (m[k] || 0) + 1; };
        
        const minCourtScore = (combo: number[], partnerMap: any) => Math.min(
          gv(partnerMap, combo[0], combo[1]) + gv(partnerMap, combo[2], combo[3]),
          gv(partnerMap, combo[0], combo[2]) + gv(partnerMap, combo[1], combo[3]),
          gv(partnerMap, combo[0], combo[3]) + gv(partnerMap, combo[1], combo[2])
        );

        const bestSplitOf = (combo: number[], partnerMap: any) => {
          const opts = [[[combo[0], combo[1]], [combo[2], combo[3]]], [[combo[0], combo[2]], [combo[1], combo[3]]], [[combo[0], combo[3]], [combo[1], combo[2]]]];
          return opts.reduce((best, cur) => {
            const s = (t: any) => gv(partnerMap, t[0][0], t[0][1]) + gv(partnerMap, t[1][0], t[1][1]);
            return s(cur) < s(best) ? cur : best;
          });
        };

        const matchesPerRotation = Math.floor(X / 4);
        const totalRounds = X;

        for (let r = 0; r < totalRounds; r++) {
          // 1. Identify who sits out
          const potentialSitters = [...playersIdx].sort((a, b) => 
            sitCnt[a] !== sitCnt[b] ? sitCnt[a] - sitCnt[b] : gamesCnt[b] - gamesCnt[a]
          );
          const numSitters = X % (matchesPerRotation * 4);
          const roundSitters = potentialSitters.slice(0, numSitters);
          roundSitters.forEach(s => sitCnt[s]++);
          const active = playersIdx.filter(p => !roundSitters.includes(p));

          // 2. Exhaustive Partition Search (Exactly like roundrobin13.jsx)
          let bestPartition: number[][] = [];
          let bestScore = Infinity;

          const findBestPartition = (rem: number[], currentPartition: number[][], currentScore: number) => {
            if (currentPartition.length === matchesPerRotation) {
              if (currentScore < bestScore) {
                bestScore = currentScore;
                bestPartition = [...currentPartition];
              }
              return currentScore === 0; // Early exit
            }

            const combos = getCombos(rem, 4);
            // Limit to avoid infinite hang on very large X, but for 13 players (C(12,4)=495) it's perfect
            const limit = X > 15 ? 100 : combos.length; 
            
            for (let i = 0; i < limit; i++) {
              const combo = combos[i];
              const score = minCourtScore(combo, pm);
              const nextRem = rem.filter(p => !combo.includes(p));
              if (findBestPartition(nextRem, [...currentPartition, combo], currentScore + score)) return true;
            }
            return false;
          };

          findBestPartition(active, [], 0);

          // 3. Commit best result
          const courts = bestPartition.map(court => bestSplitOf(court, pm));
          courts.forEach(([tA, tB], cIdx) => {
            inc(pm, tA[0], tA[1]); inc(pm, tB[0], tB[1]);
            tA.forEach(a => tB.forEach(b => inc(om, a, b)));
            schedule.push({ 
              teamA: [pIds[tA[0]], pIds[tA[1]]], 
              teamB: [pIds[tB[0]], pIds[tB[1]]],
              rotation: r + 1,
              court: cIdx + 1,
              sitterId: roundSitters.map(s => pIds[s]).join(',')
            });
            [...tA, ...tB].forEach(p => gamesCnt[p]++);
          });
        }

        setPendingMixInMatches([]);
        setPendingMixInMatches(schedule);
        setFullRotationSchedule(schedule);
        setShowRotationTable(true);
        const successMsg = `Đã tạo thành công danh sách ${schedule.length} trận đấu xoay vòng chuẩn (thuật toán Exhaustive Search) cho ${X} người.`;
        if (Platform.OS === 'web') window.alert(successMsg);
        else Alert.alert('Thành công', successMsg);
      } catch (error: any) {
        if (Platform.OS === 'web') window.alert('Lỗi: ' + error.message);
        else Alert.alert('Lỗi thuật toán', error.message);
      } finally {
        setSubmitting(false);
      }
    };

    const confirmMsg = `Hệ thống sẽ chạy thuật toán Exhaustive Search để tạo ${X * Math.floor(X / 4)} trận đấu tối ưu cho ${X} người. Bạn có chắc chắn?`;
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) performGeneration();
    } else {
      Alert.alert('Xác nhận', confirmMsg, [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Đồng ý', onPress: performGeneration }
      ]);
    }
  };
  const validMatches = matches.filter(m => m.status !== 'cancelled')
  const finishedMatches = matches.filter(m => m.status === 'finished')

  // Helper to safely get players from snapshot (handles both Object and String/JSON)
  const getPlayersFromSnapshot = (snapshot: any): { team_a: string[], team_b: string[] } => {
    try {
      if (!snapshot) return { team_a: [], team_b: [] }
      const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot
      return {
        team_a: (parsed.team_a || []).map((id: any) => String(id)),
        team_b: (parsed.team_b || []).map((id: any) => String(id))
      }
    } catch (e) {
      return { team_a: [], team_b: [] }
    }
  }

  // Count total matches played per player (ONLY playing or finished)
  const matchesPlayed = new Map<string, number>()
  activePlayers.forEach(p => matchesPlayed.set(String(p.id), 0))
  validMatches.forEach(m => {
    const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
    const all = [...team_a, ...team_b]
    all.forEach(pid => {
      if (matchesPlayed.has(pid)) {
        matchesPlayed.set(pid, (matchesPlayed.get(pid) ?? 0) + 1)
      }
    })
  })

  // Maps to track encounters (using safe snapshot)
  const metMap = new Map<string, Set<string>>()
  const partnerMap = new Map<string, Set<string>>()
  activePlayers.forEach(p => {
    metMap.set(String(p.id), new Set())
    partnerMap.set(String(p.id), new Set())
  })

  finishedMatches.forEach(m => {
    const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
    
    if (team_a.length === 2) {
      partnerMap.get(team_a[0])?.add(team_a[1])
      partnerMap.get(team_a[1])?.add(team_a[0])
    }
    if (team_b.length === 2) {
      partnerMap.get(team_b[0])?.add(team_b[1])
      partnerMap.get(team_b[1])?.add(team_b[0])
    }

    team_a.forEach(pid => {
      team_b.forEach(opponent => {
        if (metMap.has(pid)) metMap.get(pid)!.add(opponent)
        if (metMap.has(opponent)) metMap.get(opponent)!.add(pid)
      })
    })
  })

  const totalPlayers = activePlayers.length
  const isRotationComplete = totalPlayers >= 2 && activePlayers.every(p => {
    const met = metMap.get(String(p.id))
    return met && met.size >= totalPlayers - 1
  })

  // Player with fewest encounters (for progress tracking)
  const playerEncounterCounts = activePlayers.map(p => ({
    id: String(p.id),
    name: p.name,
    met: metMap.get(String(p.id))?.size ?? 0,
    played: matchesPlayed.get(String(p.id)) ?? 0
  })).sort((a, b) => a.name.localeCompare(b.name))

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



  const handleGenerateMixInRound = () => {
    if (isAfterEnd) return
    
    // 1. Identify who is TRULY available
    const busyFromDb = new Set(matches
      .filter(m => m.status === 'playing' || m.status === 'pending')
      .flatMap(m => {
        const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
        return [...team_a, ...team_b]
      })
    )
    const alreadyPendingIds = new Set(pendingMixInMatches.flatMap(m => [
      ...m.teamA.map(pid => String(pid)), 
      ...m.teamB.map(pid => String(pid))
    ]))
    
    const trulyAvailable = activePlayers.filter(p => {
      const sid = String(p.id)
      return !busyFromDb.has(sid) && !alreadyPendingIds.has(sid)
    })

    if (trulyAvailable.length < 4) {
      Alert.alert('Hết người rảnh', 'Tất cả mọi người đều đang thi đấu hoặc đã có lịch chờ.')
      return
    }

    // 2. Projected Matches Calculation
    const projectedMatches = new Map<string, number>()
    activePlayers.forEach(p => projectedMatches.set(String(p.id), matchesPlayed.get(String(p.id)) ?? 0))
    
    pendingMixInMatches.forEach(m => {
      [...m.teamA, ...m.teamB].forEach(pid => {
        const sid = String(pid)
        if (projectedMatches.has(sid)) {
          projectedMatches.set(sid, (projectedMatches.get(sid) ?? 0) + 1)
        }
      })
    })

    // 3. Hard Match-Gap Filter (Priority #1)
    const checkedInPlayers = activePlayers.filter(p => p.checkInStatus === 'checked_in')
    const referenceGroup = checkedInPlayers.length > 0 ? checkedInPlayers : activePlayers
    const allProjectedCounts = referenceGroup.map(p => projectedMatches.get(String(p.id)) ?? 0)
    const globalMinMatches = Math.min(...allProjectedCounts)
    
    // Only allow people who won't violate the Match Gap-1 rule
    const allowedByMatch = trulyAvailable.filter(p => {
      const pCount = projectedMatches.get(String(p.id)) ?? 0
      return pCount <= globalMinMatches + 1
    })

    if (allowedByMatch.length < 4) {
      Alert.alert('Chờ cân bằng', 'Cần đợi một số người đánh xong để đảm bảo khoảng cách trận đấu không quá 1.')
      return
    }

    // 4. Secondary Sorting: Prioritize Encounter Balance (Soft Constraint)
    const allMetCounts = referenceGroup.map(p => metMap.get(String(p.id))?.size ?? 0)
    const globalMinMet = Math.min(...allMetCounts)
    
    const sortedAllowed = [...allowedByMatch].sort((a, b) => {
      const sA = String(a.id); const sB = String(b.id)
      
      // Tier 1: Matches Played (Lower is better)
      const countA = projectedMatches.get(sA) ?? 0
      const countB = projectedMatches.get(sB) ?? 0
      if (countA !== countB) return countA - countB
      
      // Tier 2: Encounter Gap (If someone is already >2 ahead of the minimum, they get lower priority)
      const metA = metMap.get(sA)?.size ?? 0
      const metB = metMap.get(sB)?.size ?? 0
      const isOverA = metA > globalMinMet + 2
      const isOverB = metB > globalMinMet + 2
      if (isOverA !== isOverB) return isOverA ? 1 : -1
      
      // Tier 3: Absolute number of encounters
      if (metA !== metB) return metA - metB
      
      return Math.random() - 0.5
    })
    
    // Pick the most urgent seed
    const seedPlayer = sortedAllowed[0]
    const others = sortedAllowed.slice(1)
    
    // We want to pick 3 people from 'others' who have NOT met seedPlayer
    const seedMet = metMap.get(String(seedPlayer.id))
    const notMetOthers = others.filter(o => !seedMet?.has(String(o.id)))
    const metOthers = others.filter(o => seedMet?.has(String(o.id)))
    
    // Take as many as possible from notMetOthers, fill the rest from metOthers
    const finalFour = [seedPlayer, ...notMetOthers.slice(0, 3)]
    if (finalFour.length < 4) {
      finalFour.push(...metOthers.slice(0, 4 - finalFour.length))
    }
    
    let bestMatch: PendingMatch = { teamA: [], teamB: [] }
    let lowestMatchScore = Infinity

    // Try 200 combinations within these 4 specific people to find the best teams
    for (let i = 0; i < 200; i++) {
      const shuffle = [...finalFour].sort(() => Math.random() - 0.5)
      const teamA = [shuffle[0].id, shuffle[1].id]
      const teamB = [shuffle[2].id, shuffle[3].id]
      
      let score = 0
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          if (!metMap.get(pA)?.has(pB)) score -= 1000 
          else score += 1
        })
      })
      if (partnerMap.get(teamA[0])?.has(teamA[1])) score += 50
      if (partnerMap.get(teamB[0])?.has(teamB[1])) score += 50

      if (score < lowestMatchScore) {
        lowestMatchScore = score
        bestMatch = { teamA, teamB }
      }
    }

    setPendingMixInMatches(prev => [...prev, bestMatch])
    const newPendingIds = new Set([...alreadyPendingIds, ...bestMatch.teamA, ...bestMatch.teamB])
    const sittingOut = activePlayers.filter(p => {
      const sid = String(p.id)
      return !busyFromDb.has(sid) && !newPendingIds.has(sid)
    }).map(p => p.id)
    setSittingOutPlayers(sittingOut)
  }

  const handleConfirmMixInMatch = async (match: PendingMatch) => {
    setSubmitting(true)
    const { error } = await supabase.from('session_matches').insert({
      session_id: sessionId,
      team_a_no: 0,
      team_b_no: 0,
      status: 'playing',
      players_snapshot: { 
        team_a: match.teamA, 
        team_b: match.teamB,
        rotation: match.rotation,
        court: match.court,
        sitter_id: match.sitterId
      }
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
                backgroundColor: activeMatches.length > 0 ? theme?.primary : '#F1EFE8',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4
              }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: activeMatches.length > 0 ? '#E1F5EE' : '#B4B2A9' }} />
                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: activeMatches.length > 0 ? 'white' : '#7A8884' }}>
                  {activeMatches.length} TRẬN LIVE
                </Text>
              </View>
            </View>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={handleGenerateMixInRound}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    backgroundColor: theme?.primary,
                    padding: 16,
                    borderRadius: RADIUS.lg,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: submitting ? 0.6 : 1,
                    ...LAYOUT_SHADOW.sm
                  }}
                >
                  <SwordsIcon size={20} color="white" style={{ marginRight: 8 }} />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Bốc 1 trận</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleGenerateFixedSchedule}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    backgroundColor: activePlayers.length >= 4 ? '#1d4ed8' : '#64748b',
                    padding: 16,
                    borderRadius: RADIUS.lg,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: submitting ? 0.6 : 1,
                    ...LAYOUT_SHADOW.sm
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>
                    {activePlayers.length >= 4 ? `Lịch ${activePlayers.length} người` : `Cần >= 4 người (đang có ${activePlayers.length})`}
                  </Text>
                </TouchableOpacity>
              </View>

              {fullRotationSchedule.length > 0 && (
                <TouchableOpacity 
                  onPress={() => setShowRotationTable(!showRotationTable)}
                  style={{ 
                    backgroundColor: '#F5F1E8', 
                    padding: 12, 
                    borderRadius: RADIUS.md, 
                    marginBottom: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#E5E3DC'
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A' }}>
                    {showRotationTable ? 'Ẩn bảng tiến độ' : 'Xem bảng tiến độ xoay vòng'}
                  </Text>
                </TouchableOpacity>
              )}

              {showRotationTable && fullRotationSchedule.some(m => m.rotation) && (
                <View style={{ backgroundColor: '#F9F8F4', borderRadius: RADIUS.lg, padding: 12, marginBottom: 24, borderWidth: 1, borderColor: '#E5E3DC' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', marginBottom: 12, textAlign: 'center' }}>
                    BẢNG LỊCH ĐẤU CHI TIẾT ({scheduledPlayers.length} NGƯỜI)
                  </Text>
                  
                  {Array.from({ length: scheduledPlayers.length }).map((_, rIdx) => {
                    const rotationNum = rIdx + 1;
                    const rotationMatches = fullRotationSchedule.filter(m => m.rotation === rotationNum);
                    
                    // Even if no matches found in fullRotationSchedule (shouldn't happen if generated),
                    // we show the rotation header to keep the table structure fixed.
                    const sitterIds = rotationMatches.length > 0 
                      ? (rotationMatches[0]?.sitterId?.split(',') || [])
                      : [];
                    const sitterNames = sitterIds
                      .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name || 'N/A')
                      .sort()
                      .join(', ');

                    return (
                      <View key={rotationNum} style={{ marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', pb: 8 }}>
                        <View style={{ backgroundColor: '#E1F5EE', padding: 6, borderRadius: 4, marginBottom: 8 }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F6E56' }}>
                            Rotation {rotationNum} — {sitterNames ? `${sitterNames} nghỉ` : 'Cả sân cùng đánh'}
                          </Text>
                        </View>
                        
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1EFE8', paddingBottom: 4 }}>
                            <Text style={{ flex: 0.5, fontSize: 10, fontWeight: '700', color: '#7A8884' }}>Trận</Text>
                            <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#0F6E56' }}>Đội Xanh</Text>
                            <Text style={{ flex: 0.5, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>vs</Text>
                            <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#1d4ed8' }}>Đội Tím</Text>
                            <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#B4B2A9', textAlign: 'right' }}>Chờ</Text>
                          </View>
                          
                          {rotationMatches.map((m, mIdx) => {
                            const matchNum = (rIdx * 3) + mIdx + 1;
                            const playingIds = new Set([...m.teamA, ...m.teamB]);
                            const waitingNames = scheduledPlayers
                              .filter(p => !sitterIds.includes(String(p.id)) && !playingIds.has(String(p.id)))
                              .map(p => p.name.split(' ').pop()) // Just last name for space
                              .sort((a, b) => (a || '').localeCompare(b || ''))
                              .join(', ');

                            return (
                              <View key={mIdx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                                <Text style={{ flex: 0.5, fontSize: 11, fontWeight: '600' }}>{matchNum}</Text>
                                <Text style={{ flex: 2, fontSize: 11, color: '#0F6E56' }} numberOfLines={1}>
                                  {m.teamA
                                    .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name.split(' ').pop() || '')
                                    .sort((a, b) => a.localeCompare(b))
                                    .join(', ')}
                                </Text>
                                <Text style={{ flex: 0.5, fontSize: 10, color: '#B4B2A9', textAlign: 'center' }}>vs</Text>
                                <Text style={{ flex: 2, fontSize: 11, color: '#1d4ed8' }} numberOfLines={1}>
                                  {m.teamB
                                    .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name.split(' ').pop() || '')
                                    .sort((a, b) => a.localeCompare(b))
                                    .join(', ')}
                                </Text>
                                <Text style={{ flex: 2, fontSize: 9, color: '#7A8884', textAlign: 'right' }} numberOfLines={1}>{waitingNames}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

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
                  backgroundColor: theme?.primary,
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
              const teamAPlayers = match.teamA
                .map(pid => players.find(p => p.id === pid))
                .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''))
              const teamBPlayers = match.teamB
                .map(pid => players.find(p => p.id === pid))
                .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''))
              return (
                <View key={idx} style={{
                  backgroundColor: '#F5F1E8',
                  borderRadius: RADIUS.lg,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: '#E5E3DC',
                  overflow: 'hidden'
                }}>
                  {match.rotation && (
                    <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 12, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#0F6E56', fontWeight: '800' }}>
                        ROTATION {match.rotation} — {
                          match.sitterId?.split(',')
                            .map(id => players.find(p => String(p.id) === id)?.name || 'N/A')
                            .join(', ')
                        } nghỉ
                      </Text>
                    </View>
                  )}
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
                  GỢI Ý ƯU TIÊN (DỰA TRÊN SỐ TRẬN)
                </Text>
                {(showAllProgress ? playerEncounterCounts : playerEncounterCounts.slice(0, 4)).map(({ id, name, met, played }) => (
                  <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#1A2E2A', fontWeight: '600' }}>{name}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884' }}>Đã đánh {played} trận</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', flex: 2 }}>
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
                    <View style={{ width: 45, alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: met >= totalPlayers - 1 ? '#0F6E56' : '#854F0B', fontWeight: '800' }}>
                        {met}/{totalPlayers - 1}
                      </Text>
                      <Text style={{ fontSize: 8, color: '#B4B2A9', fontWeight: '600' }}>GẶP MẶT</Text>
                    </View>
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
