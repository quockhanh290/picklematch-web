import { Tier } from '../../../lib/next-round-suggester/classify'
import { suggestNextMatch, suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createPlayers, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('suggestNextRound', () => {
  it('still suggests matches when MUST_PLAY overrides exceed court capacity', () => {
    const state = createState({
      courts: 1,
      players: createPlayers(8),
    })

    const result = suggestNextRound(state, {
      tier_overrides: {
        p01: Tier.MUST_PLAY,
        p02: Tier.MUST_PLAY,
        p03: Tier.MUST_PLAY,
        p04: Tier.MUST_PLAY,
        p05: Tier.MUST_PLAY,
      },
    })

    expect(result.warnings).toContain('MUST_PLAY_OVER_CAPACITY')
    expect(result.warnings).not.toContain('NO_VALID_MATCH')
    expect(result.alternatives.length).toBeGreaterThan(0)
    expect(result.alternatives[0].matches).toHaveLength(1)
  })

  it('keeps suggestion quality equivalent with and without partition cache', () => {
    const state = createState({
      courts: 4,
      players: createPlayers(20),
    })

    const cached = suggestNextRound(state)
    const uncached = suggestNextRound(state, { partition_cache: false })

    expect(cached.alternatives).toHaveLength(uncached.alternatives.length)
    expect(cached.alternatives.map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    }))).toEqual(uncached.alternatives.map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    })))
  })

  it('suggests one next match while excluding busy players', () => {
    const state = createState({
      courts: 4,
      players: createPlayers(12),
    })

    const result = suggestNextMatch(state, {
      busy_player_ids: ['p01', 'p02', 'p03', 'p04'],
      court_idx: 2,
    })

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0].matches).toHaveLength(1)
    expect(result.alternatives[0].matches[0].court_idx).toBe(2)
    const selectedIds = new Set([
      ...result.alternatives[0].matches[0].team_a,
      ...result.alternatives[0].matches[0].team_b,
    ])
    expect([...selectedIds].some(id => ['p01', 'p02', 'p03', 'p04'].includes(id))).toBe(false)
  })

  it('avoids a recent near-rematch when rested players can form another match', () => {
    const players = createPlayers(8, { pvna: 3.0 })
    const state = {
      ...createState({
        courts: 1,
        players,
        currentRound: 1,
        pvnaTolerance: 10,
      }),
      rounds: [{
        session_id: 'session-test',
        round_no: 0,
        status: 'completed' as const,
        matches: [{
          court_idx: 0,
          team_a: ['p01', 'p02'] as [string, string],
          team_b: ['p03', 'p04'] as [string, string],
        }],
        resting: ['p05', 'p06', 'p07', 'p08'],
        started_at: null,
        ended_at: null,
      }],
    }

    const result = suggestNextMatch(state)
    const match = result.alternatives[0]?.matches[0]
    const previousIds = new Set(['p01', 'p02', 'p03', 'p04'])
    const overlap = match
      ? [...match.team_a, ...match.team_b].filter(playerId => previousIds.has(playerId)).length
      : 0

    expect(match).toBeTruthy()
    expect(overlap).toBeLessThan(3)
  })

  it('prefers a strict PVNA match over a relaxed higher-priority candidate', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p01', { pvna: 4.0 }),
        createPlayer('p02', { pvna: 3.9 }),
        createPlayer('p03', { pvna: 3.8 }),
        createPlayer('p04', { pvna: 3.0 }),
        createPlayer('p05', { pvna: 3.2 }),
        createPlayer('p06', { pvna: 3.2 }),
        createPlayer('p07', { pvna: 3.2 }),
        createPlayer('p08', { pvna: 3.2 }),
      ],
    })

    const result = suggestNextMatch(state)
    const match = result.alternatives[0]?.matches[0]

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).not.toContain('PVNA_TOLERANCE_RELAXED')
    expect(match?.stats?.pvna_diff).toBeLessThanOrEqual(0.5)
  })

  it('only marks repeat cap relaxed when no under-cap match exists', () => {
    const players = createPlayers(4)
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) {
        setPartnerRepeats(players[left], players[right], 2)
      }
    }
    const state = createState({
      courts: 1,
      players,
    })

    const result = suggestNextMatch(state)

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('REPEAT_CAP_RELAXED')
    expect(result.alternatives[0]?.approval_required).toBe(true)
    const tradeoff = result.alternatives[0]?.tradeoffs?.find(item => item.type === 'repeat_cap_relaxed')

    expect(tradeoff?.over_by).toBeGreaterThan(0)
    expect(tradeoff?.affected_pairs).toBeGreaterThan(0)
    expect(tradeoff?.severity).toBeCloseTo((tradeoff?.over_by ?? 0) * 15)
  })

  it('warns when a repeat reaches the cap without requiring approval', () => {
    const players = createPlayers(4)
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) {
        setPartnerRepeats(players[left], players[right], 1)
      }
    }
    const state = createState({
      courts: 1,
      players,
    })

    const result = suggestNextMatch(state)

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('REPEAT_CAP_REACHED')
    expect(result.alternatives[0]?.warnings).not.toContain('REPEAT_CAP_RELAXED')
    expect(result.alternatives[0]?.approval_required).toBe(false)
  })

  it('adds a tradeoff cost when intra-team gap must be relaxed', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 10,
      players: [
        createPlayer('p1', { pvna: 2.0 }),
        createPlayer('p2', { pvna: 3.2 }),
        createPlayer('p3', { pvna: 4.4 }),
        createPlayer('p4', { pvna: 5.6 }),
      ],
    })

    const result = suggestNextMatch(state)

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('INTRA_TEAM_GAP_RELAXED')
    const tradeoff = result.alternatives[0]?.tradeoffs?.find(item => item.type === 'intra_team_gap_relaxed')

    expect(tradeoff?.over_by).toBeGreaterThan(0)
    expect(tradeoff?.affected_pairs).toBeGreaterThan(0)
    expect(tradeoff?.severity).toBeCloseTo((tradeoff?.over_by ?? 0) * 8)
  })

  it('adds a tradeoff cost when intra-team gap exceeds preferred limit within hard limit', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.8 }),
        createPlayer('p3', { pvna: 3.1 }),
        createPlayer('p4', { pvna: 3.9 }),
      ],
    })

    const result = suggestNextMatch(state)

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('INTRA_TEAM_GAP_RELAXED')
    const tradeoff = result.alternatives[0]?.tradeoffs?.find(item => item.type === 'intra_team_gap_relaxed')
    expect(tradeoff?.over_by).toBeGreaterThan(0)
    expect(tradeoff?.affected_pairs).toBeGreaterThan(0)
    expect(tradeoff?.severity).toBeCloseTo((tradeoff?.over_by ?? 0) * 8)
  })

  it('finds an in-cap match when priority candidates would need intra-team relaxation', () => {
    const players = createPlayers(28)
    const fallbackIds = new Set(['p25', 'p26', 'p27', 'p28'])
    for (const player of players) {
      player.pvna = fallbackIds.has(player.player_id)
        ? 3.0
        : [1, 4, 7, 10][(Number(player.player_id.slice(1)) - 1) % 4]
    }
    const state = createState({
      courts: 1,
      players,
    })

    const result = suggestNextMatch(state)
    const match = result.alternatives[0]?.matches[0]

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).not.toContain('INTRA_TEAM_GAP_RELAXED')
    expect(result.alternatives[0]?.warnings).not.toContain('PVNA_TOLERANCE_RELAXED')
    expect(result.alternatives[0]?.warnings).not.toContain('REPEAT_CAP_RELAXED')
    expect(result.alternatives[0]?.tradeoffs ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'intra_team_gap_relaxed' }),
      ]),
    )
    expect(match?.stats?.pvna_diff).toBeLessThanOrEqual(0.5)
  })
})
