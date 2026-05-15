import type { Feasibility } from './types'

export function checkFeasibility(
  courts: number,
  nPlayers: number,
  rounds: number,
): { feasibility: Feasibility; warnings: string[] } {
  const slotsPerRound = courts * 4
  const restingPerRound = Math.max(0, nPlayers - slotsPerRound)
  const restingRatio = nPlayers <= 0 ? 1 : restingPerRound / nPlayers
  const avgMatches = nPlayers <= 0 ? 0 : (rounds * slotsPerRound) / nPlayers
  const warnings: string[] = []

  if (nPlayers < 4 || slotsPerRound > nPlayers || rounds < 1) {
    warnings.push('Khong du nguoi hoac thoi luong de chay cau hinh nay.')
    return { feasibility: 'infeasible', warnings }
  }

  if (nPlayers > 2 * slotsPerRound) {
    warnings.push('So nguoi cao so voi so san, co the co nguoi nghi lau.')
    return { feasibility: 'tight', warnings }
  }

  if (restingRatio > 0.5 || avgMatches < 2) {
    if (restingRatio > 0.5) {
      warnings.push('Qua nhieu nguoi phai nghi moi vong.')
    }
    if (avgMatches < 2) {
      warnings.push('Moi nguoi du kien choi duoi 2 tran.')
    }
    return { feasibility: 'oversupply', warnings }
  }

  return { feasibility: 'optimal', warnings }
}
