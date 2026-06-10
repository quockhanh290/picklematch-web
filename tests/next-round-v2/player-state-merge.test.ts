import { mergePlayerStateRows } from '../../features/host/session-detail/next-round-v2/player-state-rows'
import type { SessionPlayerStateRow } from '../../lib/next-round-suggester/types'

function playerRow(overrides: Partial<SessionPlayerStateRow> = {}): SessionPlayerStateRow {
  return {
    session_id: 'session-1',
    player_id: 'player-1',
    group_id: null,
    checked_in_at: '2026-06-10T00:00:00.000Z',
    checked_out_at: null,
    matches_played: 3,
    last_played_round: 2,
    consecutive_rest: 0,
    consecutive_play: 3,
    opted_rest: false,
    players: {
      name: 'Lê Tùng',
      pvna: 4.19,
      gender: 'male',
    },
    session_players: {
      metadata: { source: 'registered' },
    },
    ...overrides,
  } as SessionPlayerStateRow
}

describe('mergePlayerStateRows', () => {
  it('applies completion fairness deltas without dropping enriched player data', () => {
    const current = playerRow()
    const delta = playerRow({
      matches_played: 3,
      consecutive_rest: 1,
      consecutive_play: 0,
      players: undefined,
      session_players: undefined,
    })

    const [merged] = mergePlayerStateRows([current], [delta])

    expect(merged.consecutive_rest).toBe(1)
    expect(merged.consecutive_play).toBe(0)
    expect(merged.players).toEqual(current.players)
    expect(merged.session_players).toEqual(current.session_players)
  })

  it('leaves unchanged players referentially stable', () => {
    const unchanged = playerRow({ player_id: 'player-2' })
    const current = [unchanged]

    const result = mergePlayerStateRows(current, [])

    expect(result).toBe(current)
    expect(result[0]).toBe(unchanged)
  })
})
