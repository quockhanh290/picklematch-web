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
    expect(result.alternatives[0]?.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'repeat_cap_relaxed',
          over_by: expect.any(Number),
          affected_pairs: expect.any(Number),
        }),
      ]),
    )
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

  it('uses exhaustive fallback when priority candidates miss a strict match', () => {
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
    expect(result.alternatives[0]?.warnings).toContain('EXHAUSTIVE_FALLBACK')
    expect(result.alternatives[0]?.warnings).not.toContain('PVNA_TOLERANCE_RELAXED')
    expect(result.alternatives[0]?.warnings).not.toContain('REPEAT_CAP_RELAXED')
    expect(match?.stats?.pvna_diff).toBeLessThanOrEqual(0.5)
  })
})
