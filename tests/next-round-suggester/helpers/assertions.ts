import type { Match } from '../../../lib/next-round-suggester/types'

export function installSuggesterAssertions() {
  expect.extend({
    toHaveValidMatch(received: Match) {
      const players = [...received.team_a, ...received.team_b]
      const pass =
        received.team_a.length === 2 &&
        received.team_b.length === 2 &&
        players.length === 4 &&
        new Set(players).size === 4

      return {
        pass,
        message: () => `expected match ${JSON.stringify(received)} to contain 4 unique players`,
      }
    },

    toRespectPvnaTolerance(received: Match, tolerance: number, pvnaByPlayer: Map<string, number>) {
      const teamA = average(received.team_a.map((playerId) => pvnaByPlayer.get(playerId) ?? 3.0))
      const teamB = average(received.team_b.map((playerId) => pvnaByPlayer.get(playerId) ?? 3.0))
      const diff = Math.abs(teamA - teamB)
      const pass = diff <= tolerance

      return {
        pass,
        message: () => `expected PVNA diff ${diff} to be <= ${tolerance}`,
      }
    },

    toIncludePlayer(received: Match, playerId: string) {
      const pass = [...received.team_a, ...received.team_b].includes(playerId)

      return {
        pass,
        message: () => `expected match ${JSON.stringify(received)} to include ${playerId}`,
      }
    },
  })
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveValidMatch(): R
      toRespectPvnaTolerance(tolerance: number, pvnaByPlayer: Map<string, number>): R
      toIncludePlayer(playerId: string): R
    }
  }
}
