// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { Feasibility } from './types.ts'

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
    warnings.push('Không đủ người hoặc thời lượng để chạy cấu hình này.')
    return { feasibility: 'infeasible', warnings }
  }

  if (nPlayers > 2 * slotsPerRound) {
    warnings.push('Số người cao so với số sân, có thể có người nghỉ lâu.')
    return { feasibility: 'tight', warnings }
  }

  if (restingRatio > 0.5 || avgMatches < 2) {
    if (restingRatio > 0.5) {
      warnings.push('Quá nhiều người phải nghỉ mỗi vòng.')
    }
    if (avgMatches < 2) {
      warnings.push('Mỗi người dự kiến chơi dưới 2 trận.')
    }
    return { feasibility: 'oversupply', warnings }
  }

  return { feasibility: 'optimal', warnings }
}
