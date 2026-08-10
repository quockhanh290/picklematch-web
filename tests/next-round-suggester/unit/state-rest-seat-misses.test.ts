import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state'
import type { SessionPlayerStateRow } from '../../../lib/next-round-suggester/types'

// Rest bookkeeping used to advance only when a session-wide round_no bucket looked complete, which in
// rolling play never happens — 24 of 33 players in prod session f43a9338 carried stale counters. The fix
// has SQL record something it can state without guessing: how many times a player was passed over while
// some match finished. That is a raw count, roughly court-count times bigger than a round.
//
// Rather than rescale every threshold that reads consecutive_rest (classify's >= 1, the detector's
// 2/3/4, the fairness audit's live-vs-replay comparison, the simulator's own counter), the conversion
// happens here, at the one boundary that knows how many courts are running. Everything downstream keeps
// meaning rounds.
describe('rest_seat_misses to consecutive_rest', () => {
  const row = (over: Partial<SessionPlayerStateRow> = {}): SessionPlayerStateRow => ({
    session_id: 's',
    player_id: 'p1',
    group_id: null,
    checked_in_at: new Date().toISOString(),
    checked_out_at: null,
    matches_played: 2,
    last_played_round: 1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    effective_pvna: null,
    players: { pvna: 3.2, current_elo: null, elo: null, gender: null, partner_gender_pref: null, opponent_gender_pref: null },
    ...over,
  } as unknown as SessionPlayerStateRow)

  const restOf = (playerRow: SessionPlayerStateRow, courts: number) =>
    mapRowsToSessionState({
      sessionId: 's', playerRows: [playerRow], pairRows: [], roundRows: [], courts,
    }).players.get('p1')?.consecutive_rest

  it('counts one rested round once the player has been passed over on every court', () => {
    expect(restOf(row({ rest_seat_misses: 6 } as never), 6)).toBe(1)
  })

  it('does not count a partial pass as a rested round', () => {
    expect(restOf(row({ rest_seat_misses: 5 } as never), 6)).toBe(0)
  })

  it('scales with the court count rather than a fixed divisor', () => {
    expect(restOf(row({ rest_seat_misses: 6 } as never), 2)).toBe(3)
  })

  // The engine ships independently of the migration, so it has to read a database that does not have
  // the column yet. Falling back keeps behaviour exactly as it is today until the migration lands.
  it('falls back to the stored counter when the column is not there yet', () => {
    expect(restOf(row({ consecutive_rest: 2 }), 4)).toBe(2)
  })
})
