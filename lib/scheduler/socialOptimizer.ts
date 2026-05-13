import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { FixedTeamScheduledMatch } from './fixedTeamSchedule'
import { getPlayerSkill, getTeamSkill } from './scoring'

export type SocialOptimizerOptions = {
  targetGamesPerTeam: number
  courtCount: number
  iterations?: number
}

export type SocialPlan = {
  players: ArrangementPlayer[]
  matches: FixedTeamScheduledMatch[]
  quality: {
    runtimeMs: number
    score: number
  }
}

/**
 * Thuật toán tối ưu hóa Social: 
 * Kết hợp sắp đội và xếp lịch dựa trên mục tiêu số trận.
 */
export function optimizeSocialPlan(
  players: ArrangementPlayer[],
  options: SocialOptimizerOptions
): SocialPlan {
  const startedAt = Date.now()
  const { targetGamesPerTeam, courtCount, iterations = 5000 } = options

  // 1. Khởi tạo đội hình ngẫu nhiên (hoặc dựa trên team hiện tại)
  let currentPlayers = [...players].sort(() => Math.random() - 0.5)
  const numTeams = Math.floor(currentPlayers.length / 2)
  
  // Gán team_no tạm thời
  for (let i = 0; i < numTeams * 2; i++) {
    currentPlayers[i] = { ...currentPlayers[i], team: Math.floor(i / 2) + 1 }
  }
  // Những người dư thừa
  for (let i = numTeams * 2; i < currentPlayers.length; i++) {
    currentPlayers[i] = { ...currentPlayers[i], team: 0 }
  }

  // Helper để kiểm tra giới tính
  const normalizeGender = (g?: string | null) => {
    const s = String(g || '').toLowerCase()
    if (s === 'female' || s === 'f' || s === 'nữ' || s === 'nu') return 'female'
    if (s === 'male' || s === 'm' || s === 'nam') return 'male'
    return 'any'
  }

  // 2. Hàm tính điểm chất lượng (Fitness Function)
  const calculateScore = (ps: ArrangementPlayer[], ms: FixedTeamScheduledMatch[]) => {
    let score = 0
    const teamsMap = new Map<number, ArrangementPlayer[]>()
    ps.forEach(p => {
      if (p.team > 0) {
        if (!teamsMap.has(p.team)) teamsMap.set(p.team, [])
        teamsMap.get(p.team)!.push(p)
      }
    })

    // a. Trình độ & Partner Preference
    teamsMap.forEach(members => {
      if (members.length === 2) {
        // Phạt lệch trình partner
        score -= Math.abs(getPlayerSkill(members[0]) - getPlayerSkill(members[1])) * 10
        
        // Partner Preference (Giới tính)
        members.forEach((m, idx) => {
          const partner = members[1 - idx]
          const pref = m.metadata?.partner_gender_pref
          if (pref && pref !== 'any') {
            if (normalizeGender(partner.gender) !== normalizeGender(pref)) score -= 100
          }
        })
      }
    })

    // b. Trình độ trận đấu & Opponent Preference
    ms.forEach(m => {
      const teamA = teamsMap.get(m.teamANo) || []
      const teamB = teamsMap.get(m.teamBNo) || []
      const skillA = getTeamSkill(teamA)
      const skillB = getTeamSkill(teamB)
      const gap = Math.abs(skillA - skillB)
      
      // LUẬT: Nếu lệch > 0.5 thì phạt cực nặng để ưu tiên trình độ hơn Preference
      const skillPenaltyMult = gap > 0.5 ? 2000 : 200
      score -= Math.pow(gap, 2) * skillPenaltyMult

      // Opponent Preference (Giới tính)
      teamA.forEach(pA => {
        const pref = pA.metadata?.opponent_gender_pref
        if (pref && pref !== 'any') {
          const hasMatch = teamB.some(pB => normalizeGender(pB.gender) === normalizeGender(pref))
          if (!hasMatch) score -= 40 // Giảm nhẹ phạt để trình độ > 0.5 luôn thắng thế
        }
      })
      teamB.forEach(pB => {
        const pref = pB.metadata?.opponent_gender_pref
        if (pref && pref !== 'any') {
          const hasMatch = teamA.some(pA => normalizeGender(pA.gender) === normalizeGender(pref))
          if (!hasMatch) score -= 40
        }
      })
    })

    // c. KHÔNG GẶP LẠI ĐỐI THỦ (Repeat Penalty cực nặng)
    const pairsSeen = new Set<string>()
    ms.forEach(m => {
      const key = [m.teamANo, m.teamBNo].sort().join('-')
      if (pairsSeen.has(key)) score -= 2000 
      pairsSeen.add(key)
    })

    // d. THỜI GIAN NGHỈ (Rest Time Optimization)
    const teamSchedule = new Map<number, number[]>() // teamNo -> array of rotations
    ms.forEach(m => {
      if (!teamSchedule.has(m.teamANo)) teamSchedule.set(m.teamANo, [])
      if (!teamSchedule.has(m.teamBNo)) teamSchedule.set(m.teamBNo, [])
      teamSchedule.get(m.teamANo)!.push(m.rotation)
      teamSchedule.get(m.teamBNo)!.push(m.rotation)
    })

    teamSchedule.forEach((rots, teamNo) => {
      const sortedRots = rots.sort((a, b) => a - b)
      for (let i = 0; i < sortedRots.length - 1; i++) {
        const gap = sortedRots[i+1] - sortedRots[i]
        if (gap === 1) score -= 200 // Phạt đánh liên tiếp 
        if (gap === 2) score += 50  // Thưởng nếu nghỉ đúng 1 vòng 
        if (gap > 4) score -= 100   // Phạt nếu ngồi chơi quá lâu 
      }
    })

    return score
  }

  // 3. Hàm phân bổ rotation và court thông minh (Greedy Scheduling)
  const allocateRotations = (ms: FixedTeamScheduledMatch[]) => {
    const sortedMatches = [...ms]
    const rotationOccupancy = new Map<number, Set<number>>() 
    const rotationCourtCount = new Map<number, number>() 

    sortedMatches.forEach((m) => {
      let r = 1
      while (true) {
        const teamsInR = rotationOccupancy.get(r) || new Set<number>()
        const courtsInR = rotationCourtCount.get(r) || 0

        // Ưu tiên: Cả 2 đội rảnh VÀ sân trống VÀ không vừa đánh ở vòng r-1 (nếu có thể)
        const teamAJustPlayed = rotationOccupancy.get(r - 1)?.has(m.teamANo)
        const teamBJustPlayed = rotationOccupancy.get(r - 1)?.has(m.teamBNo)
        
        // Nếu vừa đánh vòng trước, ta cố gắng lùi lại vòng sau
        const canWait = r < 50 
        if (canWait && (teamAJustPlayed || teamBJustPlayed)) {
          r++
          continue
        }

        if (!teamsInR.has(m.teamANo) && !teamsInR.has(m.teamBNo) && courtsInR < courtCount) {
          m.rotation = r
          m.court = courtsInR + 1
          teamsInR.add(m.teamANo)
          teamsInR.add(m.teamBNo)
          rotationOccupancy.set(r, teamsInR)
          rotationCourtCount.set(r, courtsInR + 1)
          break
        }
        r++
      }
    })
    return sortedMatches
  }

  const generateInitialMatches = (ps: ArrangementPlayer[]) => {
    const ms: FixedTeamScheduledMatch[] = []
    const teams = Array.from(new Set(ps.map(p => p.team).filter(t => t > 0))).sort((a, b) => a - b)
    if (teams.length < 2) return []

    const teamGameCount = new Map<number, number>(teams.map(t => [t, 0]))
    const playedTogether = new Set<string>()

    for (const teamA of teams) {
      while ((teamGameCount.get(teamA) || 0) < targetGamesPerTeam) {
        const potentialOpponents = teams
          .filter(t => t !== teamA)
          .filter(t => !playedTogether.has([teamA, t].sort().join('-')))
          .sort((t1, t2) => (teamGameCount.get(t1) || 0) - (teamGameCount.get(t2) || 0)) 

        if (potentialOpponents.length === 0) break 

        const teamB = potentialOpponents[0]
        playedTogether.add([teamA, teamB].sort().join('-'))
        teamGameCount.set(teamA, (teamGameCount.get(teamA) || 0) + 1)
        teamGameCount.set(teamB, (teamGameCount.get(teamB) || 0) + 1)

        ms.push({
          teamA: ps.filter(p => p.team === teamA).map(p => String(p.id)),
          teamB: ps.filter(p => p.team === teamB).map(p => String(p.id)),
          teamANo: teamA,
          teamBNo: teamB,
          rotation: 0,
          court: 0
        })
      }
    }
    return allocateRotations(ms)
  }

  let bestPlayers = [...currentPlayers]
  let bestMatches = generateInitialMatches(bestPlayers)
  let bestScore = calculateScore(bestPlayers, bestMatches)

  // 4. Vòng lặp tối ưu hóa
  for (let i = 0; i < iterations; i++) {
    let nextPlayers = [...bestPlayers]
    let nextMatches = bestMatches.map(m => ({ ...m }))
    
    const changeType = Math.random()
    
    if (changeType < 0.3) {
      // Kiểu 1: Tráo đổi 2 người giữa 2 đội
      const t1 = Math.floor(Math.random() * numTeams) + 1
      const t2 = Math.floor(Math.random() * numTeams) + 1
      if (t1 !== t2) {
        const p1Idx = nextPlayers.findIndex(p => p.team === t1)
        const p2Idx = nextPlayers.findIndex(p => p.team === t2)
        if (p1Idx !== -1 && p2Idx !== -1) {
          const tempTeam = nextPlayers[p1Idx].team
          nextPlayers[p1Idx] = { ...nextPlayers[p1Idx], team: nextPlayers[p2Idx].team }
          nextPlayers[p2Idx] = { ...nextPlayers[p2Idx], team: tempTeam }
          
          nextMatches = nextMatches.map(m => {
            if (m.teamANo === t1 || m.teamANo === t2 || m.teamBNo === t1 || m.teamBNo === t2) {
              return {
                ...m,
                teamA: nextPlayers.filter(p => p.team === m.teamANo).map(p => String(p.id)),
                teamB: nextPlayers.filter(p => p.team === m.teamBNo).map(p => String(p.id))
              }
            }
            return m
          })
          // Quan trọng: Sau khi đổi người, có thể cần phân bổ lại rotation để tránh trùng lịch
          nextMatches = allocateRotations(nextMatches)
        }
      }
    } else if (changeType < 0.6) {
      // Kiểu 2: Tráo đổi đối thủ giữa 2 trận đấu
      if (nextMatches.length >= 2) {
        const m1Idx = Math.floor(Math.random() * nextMatches.length)
        const m2Idx = Math.floor(Math.random() * nextMatches.length)
        if (m1Idx !== m2Idx) {
          const m1 = nextMatches[m1Idx]
          const m2 = nextMatches[m2Idx]
          
          // CHỈ tráo nếu không tạo ra trận đấu tự gặp chính mình
          if (m1.teamANo !== m2.teamBNo && m2.teamANo !== m1.teamBNo) {
            const tempBNo = m1.teamBNo
            const tempB = m1.teamB
            nextMatches[m1Idx] = { ...m1, teamBNo: m2.teamBNo, teamB: m2.teamB }
            nextMatches[m2Idx] = { ...m2, teamBNo: tempBNo, teamB: tempB }
            nextMatches = allocateRotations(nextMatches)
          }
        }
      }
    } else {
      // Kiểu 3: Đảo thứ tự các trận đấu
      nextMatches = allocateRotations(nextMatches.sort(() => Math.random() - 0.5))
    }

    const nextScore = calculateScore(nextPlayers, nextMatches)
    if (nextScore > bestScore) {
      bestScore = nextScore
      bestPlayers = nextPlayers
      bestMatches = nextMatches
    }
  }

  // Tính Overall Score (0-100) khớp hoàn toàn với Báo cáo chi tiết
  const finalScore = calculateScore(bestPlayers, bestMatches)
  
  let totalSkillGap = 0
  let prefHits = 0
  let prefTotal = 0
  const playerRots = new Map<string, number[]>()

  bestMatches.forEach(m => {
    const pA = bestPlayers.filter(p => m.teamA.includes(String(p.id)))
    const pB = bestPlayers.filter(p => m.teamB.includes(String(p.id)))
    const gap = Math.abs(getTeamSkill(pA) - getTeamSkill(pB))
    totalSkillGap += gap

    // Tính Pref hits cho Partner
    if (pA.length === 2) {
      const p1 = pA[0], p2 = pA[1]
      if (p1.genderPreference) { prefTotal++; if (p2.gender === p1.genderPreference) prefHits++; }
      if (p2.genderPreference) { prefTotal++; if (p1.gender === p2.genderPreference) prefHits++; }
    }
    if (pB.length === 2) {
      const p1 = pB[0], p2 = pB[1]
      if (p1.genderPreference) { prefTotal++; if (p2.gender === p1.genderPreference) prefHits++; }
      if (p2.genderPreference) { prefTotal++; if (p1.gender === p2.genderPreference) prefHits++; }
    }

    // Ghi nhận vòng đấu để tính nghỉ
    [...m.teamA, ...m.teamB].forEach(id => {
      if (!playerRots.has(id)) playerRots.set(id, [])
      playerRots.get(id)!.push(m.rotation || 0)
    })
  })

  const avgSkillGap = bestMatches.length > 0 ? totalSkillGap / bestMatches.length : 0
  const skillScoreVal = Math.max(0, 100 - (avgSkillGap * 60)) * 0.4
  const prefScoreVal = prefTotal > 0 ? (prefHits / prefTotal) * 100 * 0.4 : 40
  
  let totalConsecutive = 0
  playerRots.forEach(rots => {
    const sorted = rots.sort((a,b) => a-b)
    for (let i=0; i<sorted.length-1; i++) if (sorted[i+1] - sorted[i] === 1) totalConsecutive++
  })
  const restScoreVal = Math.max(0, 100 - (totalConsecutive * 10)) * 0.2

  const overallScore = Math.round(skillScoreVal + prefScoreVal + restScoreVal)

  return {
    players: bestPlayers,
    matches: bestMatches,
    quality: {
      runtimeMs: Date.now() - startedAt,
      score: finalScore,
      overallScore
    }
  }
}
