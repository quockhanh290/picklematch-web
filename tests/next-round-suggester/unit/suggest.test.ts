import { createSearchBudget } from '../../../lib/next-round-suggester/search-budget'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { DEFAULT_SUGGEST_NEXT_ROUND_RUNTIME_MS, suggestNextMatch, suggestNextRound, type SuggestionDiagnostic } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createPlayers, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

describe('suggestNextRound', () => {
  it('uses effective PVNA when choosing which equally due player rests', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('p1', { pvna: 3, effective_pvna: 4 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 3.4, effective_pvna: 3.3 }),
      ],
      pvnaTolerance: 10,
    })

    const result = suggestNextMatch(state, { exhaustive_fallback: true })
    const selected = new Set([
      ...result.alternatives[0].matches[0].team_a,
      ...result.alternatives[0].matches[0].team_b,
    ])

    expect(selected.has('p5')).toBe(true)
    expect(selected.has('p1')).toBe(false)
  })

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

    expect(cached.alternatives.length).toBeGreaterThan(0)
    expect(uncached.alternatives.length).toBeGreaterThan(0)
    expect(cached.alternatives.slice(0, 1).map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    }))).toEqual(uncached.alternatives.slice(0, 1).map((alternative) => ({
      matches: alternative.matches.length,
      resting: alternative.resting.length,
      score: alternative.score,
      stats: alternative.stats,
      warnings: alternative.warnings,
    })))
  })

  it('bounds the default full-round search while returning a valid board', () => {
    const state = createState({ courts: 4, players: createPlayers(20) })
    const diagnostics: SuggestionDiagnostic = {
      strategies: {},
      partition_count: 0,
      max_iterations: 0,
      exhaustive: false,
    }
    const result = suggestNextRound(state, { diagnostics })

    expect(result.alternatives[0]?.matches).toHaveLength(4)
    expect(diagnostics.budget_ms).toBe(DEFAULT_SUGGEST_NEXT_ROUND_RUNTIME_MS)
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

  it('can build a dedicated recent-rematch-open pool for bounded social tradeoff selection', () => {
    const players = createPlayers(5, { pvna: 3.0 })
    const state = {
      ...createState({
        courts: 1,
        players,
        currentRound: 1,
        pvnaTolerance: 0.5,
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
        resting: ['p05'],
        started_at: null,
        ended_at: null,
      }],
    }

    const result = suggestNextMatch(state, {
      allow_recent_group_rematch: true,
      exhaustive_fallback: true,
      max_alternatives: 20,
      search_budget: createSearchBudget(100_000),
    })
    const previousIds = new Set(['p01', 'p02', 'p03', 'p04'])
    const overlaps = result.alternatives.map(item => {
      const match = item.matches[0]
      return [...match.team_a, ...match.team_b]
        .filter(playerId => previousIds.has(playerId)).length
    })

    expect(result.alternatives.length).toBeGreaterThan(0)
    expect(overlaps.some(overlap => overlap === 3)).toBe(true)
  })

  it('prefers a clean recent-partner split when the same four players can be paired safely', () => {
    const state = {
      ...createState({
        courts: 1,
        currentRound: 1,
        pvnaTolerance: 10,
        players: [
          createPlayer('p01', { pvna: 3.0 }),
          createPlayer('p02', { pvna: 3.1 }),
          createPlayer('p03', { pvna: 3.2 }),
          createPlayer('p04', { pvna: 3.3 }),
          createPlayer('p05', { pvna: 3.0 }),
          createPlayer('p06', { pvna: 3.1 }),
          createPlayer('p07', { pvna: 3.2 }),
          createPlayer('p08', { pvna: 3.3 }),
        ],
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

    const result = suggestNextMatch(state, { max_alternatives: 8 })
    const match = result.alternatives[0]?.matches[0]
    const teams = match ? [match.team_a, match.team_b].map(team => [...team].sort().join(':')) : []

    expect(match).toBeTruthy()
    expect(teams).not.toContain('p01:p02')
    expect(teams).not.toContain('p03:p04')
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

  it('marks soft PVNA relaxation without marking open PVNA fallback', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.0 }),
        createPlayer('p3', { pvna: 3.0 }),
        createPlayer('p4', { pvna: 3.8 }),
      ],
    })

    const result = suggestNextMatch(state)
    const tradeoff = result.alternatives[0]?.tradeoffs?.find(item => item.type === 'pvna_tolerance_relaxed')

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('PVNA_TOLERANCE_RELAXED')
    expect(result.alternatives[0]?.warnings).not.toContain('PVNA_TOLERANCE_OPEN')
    expect(tradeoff?.relaxation_level).toBe('soft')
  })

  it('marks open PVNA fallback separately from soft relaxation', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.0 }),
        createPlayer('p3', { pvna: 3.0 }),
        createPlayer('p4', { pvna: 5.5 }),
      ],
    })

    const result = suggestNextMatch(state)
    const tradeoff = result.alternatives[0]?.tradeoffs?.find(item => item.type === 'pvna_tolerance_relaxed')

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]?.warnings).toContain('PVNA_TOLERANCE_RELAXED')
    expect(result.alternatives[0]?.warnings).toContain('PVNA_TOLERANCE_OPEN')
    expect(tradeoff?.relaxation_level).toBe('open')
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

describe('suggestNextMatch — requiredPlayerIds overflow tiebreaking', () => {
  it('when more than 4 players have consecutive_rest >= 1, selects the 4 with highest rest first', () => {
    // 8 eligible players, 5 of them have consecutive_rest >= 1
    // Expected: top-4 by consecutive_rest are prioritised, NOT all discarded
    const players = [
      createPlayer('p01', { consecutive_rest: 3, matches_played: 5 }),
      createPlayer('p02', { consecutive_rest: 2, matches_played: 5 }),
      createPlayer('p03', { consecutive_rest: 1, matches_played: 5 }),
      createPlayer('p04', { consecutive_rest: 1, matches_played: 3 }), // tiebreak: fewer matches → higher priority
      createPlayer('p05', { consecutive_rest: 1, matches_played: 6 }), // tiebreak: more matches → lower priority
      createPlayer('p06', { consecutive_rest: 0, matches_played: 5 }),
      createPlayer('p07', { consecutive_rest: 0, matches_played: 5 }),
      createPlayer('p08', { consecutive_rest: 0, matches_played: 5 }),
    ]
    const state = createState({ courts: 1, players })

    const result = suggestNextMatch(state, { exhaustive_fallback: true })
    const match = result.alternatives[0]?.matches[0]
    expect(match).toBeTruthy()

    const selected = new Set([...(match?.team_a ?? []), ...(match?.team_b ?? [])])
    // All 4 top-rest players must be in the match
    expect(selected.has('p01')).toBe(true)
    expect(selected.has('p02')).toBe(true)
    expect(selected.has('p03')).toBe(true)
    expect(selected.has('p04')).toBe(true)
    // The lower-priority rest player must NOT be selected (p05 has same rest as p03/p04 but more matches)
    expect(selected.has('p05')).toBe(false)
  })

  it('emits MUST_PLAY_OVER_CAPACITY when required set is trimmed', () => {
    // With 8 players + 1 court: benchDepth=4, mustPlayAt=1.
    // To trigger overflow, need > 4 players with consecutive_rest >= 1.
    const players = [
      createPlayer('p01', { consecutive_rest: 2, matches_played: 4 }),
      createPlayer('p02', { consecutive_rest: 2, matches_played: 4 }),
      createPlayer('p03', { consecutive_rest: 2, matches_played: 4 }),
      createPlayer('p04', { consecutive_rest: 2, matches_played: 4 }),
      createPlayer('p05', { consecutive_rest: 2, matches_played: 4 }),
      createPlayer('p06', { consecutive_rest: 0, matches_played: 4 }),
      createPlayer('p07', { consecutive_rest: 0, matches_played: 4 }),
      createPlayer('p08', { consecutive_rest: 0, matches_played: 4 }),
    ]
    const state = createState({ courts: 1, players })

    const result = suggestNextMatch(state, { exhaustive_fallback: true })
    expect(result.warnings).toContain('MUST_PLAY_OVER_CAPACITY')
    expect(result.alternatives.length).toBeGreaterThan(0)
  })
})

describe('sortSingleMatchAlternatives — projected burden tiebreaking', () => {
  it('returns a valid match and does not crash in a repeat-heavy scenario', () => {
    // All players have crossed each other before — burden sort must handle gracefully
    const players = createPlayers(8, { pvna: 3.0 })
    const state = createState({ courts: 1, players, pvnaTolerance: 10 })

    // Create a dense web of opponent repeats
    for (const [idA, pA] of state.players) {
      for (const [idB, pB] of state.players) {
        if (idA >= idB) continue
        setOpponentRepeats(pA, pB, 2)
        setPartnerRepeats(pA, pB, 2)
      }
    }

    const result = suggestNextMatch(state, { exhaustive_fallback: true, max_alternatives: 3 })
    expect(result.alternatives.length).toBeGreaterThan(0)
    const match = result.alternatives[0]?.matches[0]
    expect(match).toBeTruthy()
    expect(new Set([...match!.team_a, ...match!.team_b]).size).toBe(4)
  })

  it('ranks alternatives so that no later alternative has strictly lower repeat burden than the top', () => {
    // Force PVNA tradeoff by tight tolerance — fallback will fire and sort multiple alternatives
    const players = [
      createPlayer('p01', { pvna: 1.0 }),
      createPlayer('p02', { pvna: 5.0 }),
      createPlayer('p03', { pvna: 1.0 }),
      createPlayer('p04', { pvna: 5.0 }),
      createPlayer('p05', { pvna: 1.0 }),
      createPlayer('p06', { pvna: 5.0 }),
      createPlayer('p07', { pvna: 1.0 }),
      createPlayer('p08', { pvna: 5.0 }),
    ]
    const state = createState({ courts: 1, players, pvnaTolerance: 0.1 })

    // p01-p04 have heavy opponent history — should be ranked lower than p05-p08
    const p01 = state.players.get('p01')!
    const p02 = state.players.get('p02')!
    const p03 = state.players.get('p03')!
    const p04 = state.players.get('p04')!
    setOpponentRepeats(p01, p02, 4)
    setOpponentRepeats(p03, p04, 4)
    setOpponentRepeats(p01, p03, 4)
    setOpponentRepeats(p02, p04, 4)

    const result = suggestNextMatch(state, { exhaustive_fallback: true, max_alternatives: 10 })
    expect(result.alternatives.length).toBeGreaterThan(0)

    // Top alternative must not include all 4 high-burden players when a lower-burden group exists
    const top = result.alternatives[0]?.matches[0]
    expect(top).toBeTruthy()
    const topIds = new Set([...(top?.team_a ?? []), ...(top?.team_b ?? [])])
    // p05-p08 have zero repeat burden — if they appear as a group they should beat p01-p04
    const isAllHighBurden =
      topIds.has('p01') && topIds.has('p02') && topIds.has('p03') && topIds.has('p04')
    expect(isAllHighBurden).toBe(false)
  })
})
