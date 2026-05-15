import { buildPairHistoryUpdates, commitCompletedRound } from '../../../lib/next-round-suggester/commit'
import { createMatch, createPlayer, createState } from '../helpers/factories'

describe('commitCompletedRound', () => {
  it('increments matches_played for players and keeps resting players unchanged for matches', () => {
    const state = createState({
      players: [createPlayer('p1'), createPlayer('p2'), createPlayer('p3'), createPlayer('p4'), createPlayer('p5')],
    })

    const result = commitCompletedRound(state, {
      round_no: 3,
      matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    })

    expect(result.players.get('p1')?.matches_played).toBe(1)
    expect(result.players.get('p4')?.matches_played).toBe(1)
    expect(result.players.get('p5')?.matches_played).toBe(0)
  })

  it('updates consecutive play and rest streaks', () => {
    const state = createState({
      players: [
        createPlayer('p1', { consecutive_play: 1 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
        createPlayer('p5', { consecutive_rest: 1 }),
      ],
    })

    const result = commitCompletedRound(state, {
      round_no: 1,
      matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    })

    expect(result.players.get('p1')?.consecutive_play).toBe(2)
    expect(result.players.get('p1')?.consecutive_rest).toBe(0)
    expect(result.players.get('p5')?.consecutive_play).toBe(0)
    expect(result.players.get('p5')?.consecutive_rest).toBe(2)
  })

  it('increments partner_counts for both partner directions in pair history rows', () => {
    const rows = buildPairHistoryUpdates('session-test', [createMatch(['p1', 'p2'], ['p3', 'p4'])])
    const byKey = new Map(rows.map((row) => [`${row.player_a}:${row.player_b}`, row]))

    expect(byKey.get('p1:p2')?.partner_count).toBe(1)
    expect(byKey.get('p3:p4')?.partner_count).toBe(1)
  })

  it('increments opponent_counts for all four opponent pairs', () => {
    const rows = buildPairHistoryUpdates('session-test', [createMatch(['p1', 'p2'], ['p3', 'p4'])])
    const byKey = new Map(rows.map((row) => [`${row.player_a}:${row.player_b}`, row]))

    expect(byKey.get('p1:p3')?.opponent_count).toBe(1)
    expect(byKey.get('p1:p4')?.opponent_count).toBe(1)
    expect(byKey.get('p2:p3')?.opponent_count).toBe(1)
    expect(byKey.get('p2:p4')?.opponent_count).toBe(1)
  })

  it('does not mutate input state', () => {
    const p1 = createPlayer('p1')
    p1.partner_counts.set('p2', 1)
    const state = createState({
      players: [p1, createPlayer('p2'), createPlayer('p3'), createPlayer('p4'), createPlayer('p5')],
    })

    const result = commitCompletedRound(state, {
      round_no: 1,
      matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    })

    expect(state.players.get('p1')?.matches_played).toBe(0)
    expect(state.players.get('p5')?.consecutive_rest).toBe(0)
    expect(result.players).not.toBe(state.players)
    expect(result.players.get('p1')?.partner_counts).not.toBe(state.players.get('p1')?.partner_counts)
  })
})
