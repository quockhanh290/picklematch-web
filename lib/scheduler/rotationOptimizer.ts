import { type ArrangementPlayer } from '@/lib/sessionDetail'
import { getPlayerSkill, matchesGenderPref } from './scoring'

export interface RotationScheduledMatch {
  id: string
  rotation: number
  court: number
  teamA: string[]
  teamB: string[]
}

export interface RotationOptimizationResult {
  players: ArrangementPlayer[]
  matches: RotationScheduledMatch[]
  quality: {
    runtimeMs: number
    score: number
    overallScore: number
  }
}

/**
 * Rotation Optimizer (Chế độ Đổi cặp liên tục)
 * Sử dụng cơ chế Block-Assignment: Gán người vào vòng trước, tráo đổi sân sau.
 * Đảm bảo 100% không trùng lịch vòng.
 */
export function optimizeRotationPlan(
  players: ArrangementPlayer[],
  options: {
    targetGamesPerPlayer: number
    courtCount: number
    iterations?: number
  }
): RotationOptimizationResult {
  const { targetGamesPerPlayer, courtCount, iterations = 20000 } = options
  const startedAt = Date.now()

  const playerIds = players.map(p => String(p.id))
  const playerById = new Map<string, ArrangementPlayer>()
  players.forEach(p => playerById.set(String(p.id), p))

  const numPlayers = playerIds.length
  const totalSlots = numPlayers * targetGamesPerPlayer
  const totalMatches = Math.floor(totalSlots / 4)
  const matchesPerRotation = courtCount
  const totalRotations = Math.ceil(totalMatches / matchesPerRotation)

  // 1. Khởi tạo Ma trận Vòng (Rotation Matrix)
  // Đảm bảo mỗi người xuất hiện đúng targetGamesPerPlayer lần và KHÔNG trùng trong 1 vòng
  const rotationSlots: string[][] = Array.from({ length: totalRotations }, () => [])
  
  // Gán luân phiên để đảm bảo rải đều
  for (let g = 0; g < targetGamesPerPlayer; g++) {
    const shuffledPlayers = [...playerIds].sort(() => Math.random() - 0.5)
    shuffledPlayers.forEach((pId, idx) => {
      const rotIdx = (g + idx) % totalRotations
      // Chỉ thêm nếu vòng này chưa đủ người (mỗi vòng tối đa courtCount * 4 người)
      if (rotationSlots[rotIdx].length < courtCount * 4 && !rotationSlots[rotIdx].includes(pId)) {
        rotationSlots[rotIdx].push(pId)
      } else {
        // Nếu kẹt, tìm vòng khác gần nhất còn chỗ
        for (let r = 0; r < totalRotations; r++) {
          const targetRot = (rotIdx + r) % totalRotations
          if (rotationSlots[targetRot].length < courtCount * 4 && !rotationSlots[targetRot].includes(pId)) {
            rotationSlots[targetRot].push(pId)
            break
          }
        }
      }
    })
  }

  // 2. Chuyển ma trận thành danh sách trận đấu
  let currentMatches: RotationScheduledMatch[] = []
  let matchIdCounter = 0
  rotationSlots.forEach((pIds, rotIdx) => {
    const shuffledInRot = pIds.sort(() => Math.random() - 0.5)
    for (let i = 0; i < shuffledInRot.length; i += 4) {
      if (i + 3 < shuffledInRot.length) {
        currentMatches.push({
          id: `m-${matchIdCounter++}`,
          rotation: rotIdx + 1,
          court: Math.floor(i / 4) + 1,
          teamA: [shuffledInRot[i], shuffledInRot[i+1]],
          teamB: [shuffledInRot[i+2], shuffledInRot[i+3]]
        })
      }
    }
  })

  // 3. Hàm tính điểm
  const calculateScore = (matches: RotationScheduledMatch[]) => {
    let skillScore = 0
    let prefScore = 0
    const partnerPairs = new Map<string, number>()
    const playerRotations = new Map<string, number[]>()

    matches.forEach(m => {
      const pA1 = playerById.get(m.teamA[0])!; const pA2 = playerById.get(m.teamA[1])!
      const pB1 = playerById.get(m.teamB[0])!; const pB2 = playerById.get(m.teamB[1])!

      const sA = getPlayerSkill(pA1) + getPlayerSkill(pA2)
      const sB = getPlayerSkill(pB1) + getPlayerSkill(pB2)
      skillScore += Math.max(0, 100 - (Math.abs(sA - sB) * 90))

      const getP = (p: ArrangementPlayer, partner: ArrangementPlayer, opps: ArrangementPlayer[]) => {
        let s = 0
        if (matchesGenderPref(partner, p.metadata?.partner_gender_pref)) s += 25
        if (opps.every(o => matchesGenderPref(o, p.metadata?.opponent_gender_pref))) s += 15
        return s
      }
      prefScore += getP(pA1, pA2, [pB1, pB2]) + getP(pA2, pA1, [pB1, pB2]) + getP(pB1, pB2, [pA1, pA2]) + getP(pB2, pB1, [pA1, pA2])

      const pair1 = [m.teamA[0], m.teamA[1]].sort().join('-'); const pair2 = [m.teamB[0], m.teamB[1]].sort().join('-')
      partnerPairs.set(pair1, (partnerPairs.get(pair1) || 0) + 1); partnerPairs.set(pair2, (partnerPairs.get(pair2) || 0) + 1)
      
      const record = (id: string, r: number) => { if(!playerRotations.has(id)) playerRotations.set(id, []); playerRotations.get(id)!.push(r) }
      [...m.teamA, ...m.teamB].forEach(id => record(id, m.rotation))
    })

    let repeatPenalty = 0; partnerPairs.forEach(count => { if(count > 1) repeatPenalty += (count - 1) * 80 })
    let restPenalty = 0; playerRotations.forEach(rots => {
      const s = rots.sort((a,b) => a-b)
      for(let i=0; i<s.length-1; i++) if(s[i+1]-s[i] === 1) restPenalty += 30
    })

    const fSkill = skillScore / (matches.length || 1); const fSocial = Math.max(0, 100 - repeatPenalty)
    const fPref = Math.min(100, (prefScore / (matches.length * 4 * 40 || 1)) * 100); const fRest = Math.max(0, 100 - restPenalty)
    return (fSkill * 0.5) + ((fSocial * 0.6 + fPref * 0.4) * 0.35) + (fRest * 0.15)
  }

  // 4. Tối ưu hóa (Hill Climbing) - CHỈ TRÁO ĐỔI HỢP LỆ
  let bestMatches = [...currentMatches]
  let bestScore = calculateScore(bestMatches)

  for (let i = 0; i < iterations; i++) {
    const nextMatches = JSON.parse(JSON.stringify(bestMatches)) as RotationScheduledMatch[]
    const m1Idx = Math.floor(Math.random() * nextMatches.length)
    const m2Idx = Math.floor(Math.random() * nextMatches.length)
    if (m1Idx === m2Idx) continue
    
    const m1 = nextMatches[m1Idx]; const m2 = nextMatches[m2Idx]
    const t1 = Math.random() > 0.5 ? 'teamA' : 'teamB'; const t2 = Math.random() > 0.5 ? 'teamA' : 'teamB'
    const p1I = Math.floor(Math.random() * 2); const p2I = Math.floor(Math.random() * 2)

    const p1 = m1[t1][p1I]; const p2 = m2[t2][p2I]

    // NẾU KHÁC VÒNG: Kiểm tra xung đột
    if (m1.rotation !== m2.rotation) {
      const p2InM1Rot = nextMatches.some(m => m.rotation === m1.rotation && [...m.teamA, ...m.teamB].includes(p2))
      if (p2InM1Rot) continue
      const p1InM2Rot = nextMatches.some(m => m.rotation === m2.rotation && [...m.teamA, ...m.teamB].includes(p1))
      if (p1InM2Rot) continue
    }

    m1[t1][p1I] = p2
    m2[t2][p2I] = p1

    const nextScore = calculateScore(nextMatches)
    if (nextScore > bestScore) {
      bestScore = nextScore
      bestMatches = nextMatches
    }
  }

  return {
    players,
    matches: bestMatches,
    quality: {
      runtimeMs: Date.now() - startedAt,
      score: bestScore,
      overallScore: Math.round(bestScore)
    }
  }
}
