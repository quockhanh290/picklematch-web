import { createPlayer, simulateSession } from '../helpers/factories'

describe('full session simulation', () => {
  it('8 players, 2 courts, 5 rounds keeps match counts fair', () => {
    const result = simulateSession({
      players: 8,
      courts: 2,
      rounds: 5,
      pvnaRange: [3.0, 4.0],
    })
    const matchesPerPlayer = result.players.map((player) => player.matches_played)

    expect(Math.max(...matchesPerPlayer) - Math.min(...matchesPerPlayer)).toBeLessThanOrEqual(1)
  })

  it('9 players, 2 courts rotates rest without long rest streaks', () => {
    const result = simulateSession({ players: 9, courts: 2, rounds: 9 })

    for (const player of result.players) {
      expect(player.max_consecutive_rest).toBeLessThanOrEqual(1)
    }
    expect(result.matches_per_player_std).toBeLessThan(0.5)
  })

  it('12 players, 3 courts creates partner diversity', () => {
    const result = simulateSession({ players: 12, courts: 3, rounds: 10, searchUnits: 150_000 })

    for (const player of result.players) {
      expect(player.unique_partners).toBeGreaterThanOrEqual(5)
    }
  })

  it('16 players, 4 courts finishes within performance target', () => {
    const start = performance.now()
    simulateSession({ players: 16, courts: 4, rounds: 10 })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(60000)
  })

  it('mixed gender preferences are satisfied more often than violated', () => {
    const result = simulateSession({
      players: 12,
      courts: 3,
      rounds: 6,
      genderMode: 'mixedPrefs',
    })
    let satisfied = 0
    let checked = 0

    for (const round of result.rounds) {
      for (const match of round.matches) {
        const pairs = [
          [match.team_a[0], match.team_a[1]],
          [match.team_a[1], match.team_a[0]],
          [match.team_b[0], match.team_b[1]],
          [match.team_b[1], match.team_b[0]],
        ] as const

        for (const [playerId, partnerId] of pairs) {
          const player = result.state.players.get(playerId)
          const partner = result.state.players.get(partnerId)
          if (!player || player.partner_gender_pref === 'any') continue

          checked += 1
          if (!partner?.gender || partner.gender === player.partner_gender_pref) {
            satisfied += 1
          }
        }
      }
    }

    expect(satisfied / Math.max(1, checked)).toBeGreaterThan(0.7)
  })

  it('accepts explicit player lists for targeted simulations', () => {
    // 5 players so round 2 uses a different 4-player group (1 rests each round),
    // avoiding the group-rematch block that applies after round 1.
    const result = simulateSession({
      courts: 1,
      rounds: 2,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 3.4 }),
      ],
    })

    expect(result.rounds).toHaveLength(2)
  })
})
