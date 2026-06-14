import { classifyPlayer, getAverageMatches, Tier } from '../../../lib/next-round-suggester/classify'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import type { Match, SessionState } from '../../../lib/next-round-suggester/types'
import { generateRandomScenarios } from '../helpers/scenarios'

describe('Suggester invariants', () => {
  it.each(generateRandomScenarios(100))('holds for random scenario $name', ({ state }) => {
    const first = suggestNextRound(state)
    const second = suggestNextRound(state)

    expect(first).toEqual(second)

    const suggestion = first.alternatives[0]
    if (!suggestion) return

    const allPlaying = suggestion.matches.flatMap((match) => [...match.team_a, ...match.team_b])
    expect(new Set(allPlaying).size).toBe(allPlaying.length)
    expect(suggestion.matches.length).toBeLessThanOrEqual(state.config.courts)

    for (const match of suggestion.matches) {
      const players = [...match.team_a, ...match.team_b]
      expect(players).toHaveLength(4)
      expect(new Set(players).size).toBe(4)

      const diff = computeTeamDiff(match, state)
      if (diff > state.config.pvna_tolerance) {
        expect(suggestion.warnings).toContain('PVNA_TOLERANCE_RELAXED')
      }
    }

    const playingSet = new Set(allPlaying)
    for (const player of state.players.values()) {
      if (player.checked_out_at !== null || player.opted_rest) {
        expect(playingSet.has(player.player_id)).toBe(false)
      }
    }

    const eligible = [...state.players.values()].filter(
      (player) => player.checked_out_at === null && !player.opted_rest,
    )
    const slots = suggestion.matches.length * 4
    const avg = getAverageMatches(eligible)
    const mustPlay = eligible.filter((player) => classifyPlayer(player, { avgMatches: avg }) === Tier.MUST_PLAY)
    if (mustPlay.length <= slots) {
      for (const player of mustPlay) {
        expect(playingSet.has(player.player_id)).toBe(true)
      }
    }
  })
})

function computeTeamDiff(match: Match, state: SessionState): number {
  const teamA = sum(match.team_a.map((playerId) => state.players.get(playerId)?.pvna ?? 3.0))
  const teamB = sum(match.team_b.map((playerId) => state.players.get(playerId)?.pvna ?? 3.0))
  return Math.abs(teamA - teamB)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
