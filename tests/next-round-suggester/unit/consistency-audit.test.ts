import { buildMatchCountConsistencyRows } from '../../../lib/next-round-suggester/fairness/audit'
import { createState, createPlayer } from '../helpers/factories'

describe('buildMatchCountConsistencyRows', () => {
  it('does NOT flag a pure consecutive_play / consecutive_rest drift', () => {
    // These are order-fragile live counters (maintained incrementally across async, out-of-order
    // match completions) — they legitimately diverge from the strict round-order replay and
    // self-heal, so they must not raise the report sync warning.
    const live = createState({ players: [createPlayer('p1', { matches_played: 3, consecutive_play: 5, consecutive_rest: 0 })] })
    const replay = createState({ players: [createPlayer('p1', { matches_played: 3, consecutive_play: 2, consecutive_rest: 1 })] })
    expect(buildMatchCountConsistencyRows(live, replay)).toHaveLength(0)
  })

  it('flags a matches_played divergence (real data-integrity problem)', () => {
    const live = createState({ players: [createPlayer('p1', { matches_played: 4 })] })
    const replay = createState({ players: [createPlayer('p1', { matches_played: 3 })] })
    const rows = buildMatchCountConsistencyRows(live, replay)
    expect(rows).toHaveLength(1)
    expect(rows[0].live).toBe(4)
    expect(rows[0].replay).toBe(3)
  })

  it('flags a partner-total divergence', () => {
    const liveP = createPlayer('p1', { matches_played: 3 })
    liveP.partner_counts.set('p2', 2)
    const replayP = createPlayer('p1', { matches_played: 3 })
    replayP.partner_counts.set('p2', 1)
    expect(buildMatchCountConsistencyRows(
      createState({ players: [liveP] }),
      createState({ players: [replayP] }),
    )).toHaveLength(1)
  })

  it('flags an opponent-total divergence', () => {
    const liveP = createPlayer('p1', { matches_played: 3 })
    liveP.opponent_counts.set('p3', 3)
    const replayP = createPlayer('p1', { matches_played: 3 })
    replayP.opponent_counts.set('p3', 2)
    expect(buildMatchCountConsistencyRows(
      createState({ players: [liveP] }),
      createState({ players: [replayP] }),
    )).toHaveLength(1)
  })

  it('returns no rows when live and replay fully agree', () => {
    const live = createState({ players: [createPlayer('p1', { matches_played: 3, consecutive_play: 2 })] })
    const replay = createState({ players: [createPlayer('p1', { matches_played: 3, consecutive_play: 2 })] })
    expect(buildMatchCountConsistencyRows(live, replay)).toHaveLength(0)
  })
})
