import {
  buildBalancedRestSchedule,
  minimumPossibleMaxRestStreak,
} from '@/lib/next-round-suggester/planner/rest-schedule'
import {
  runPairSwapSearch,
  type PairSwapCheckpoint,
  type PlannedBoardMatch,
} from '@/lib/next-round-suggester/planner/pair-swap-search'
import {
  isBetterSocialPlan,
  isWithinSocialPlannerCaps,
  type SocialPlannerMetrics,
} from '@/lib/next-round-suggester/planner/objective'
import { repairUnavailablePlannedBoard, validatePlannedBoard } from '@/lib/next-round-suggester/planner/validation'
import {
  buildPrecomputedSessionPlan,
  buildPrecomputedSessionPlanChunk,
  summarizeSessionPlan,
  summarizeSessionPlanBoard,
  type SessionPlanChunkCheckpoint,
} from '@/lib/next-round-suggester/planner/session-plan'
import type { PlayerSessionState } from '@/lib/next-round-suggester/types'
import {
  aggregate,
  buildInitialState,
  buildShadowPrecomputedPlan,
} from '@/scripts/diagnostics/evaluate-session-quality-counterfactual'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'

function restMetrics(playerIds: string[], schedule: string[][]) {
  const counts = new Map(playerIds.map(id => [id, 0]))
  const streaks = new Map(playerIds.map(id => [id, 0]))
  let maxStreak = 0
  schedule.forEach(resting => {
    const restingSet = new Set(resting)
    playerIds.forEach(id => {
      const streak = restingSet.has(id) ? (streaks.get(id) ?? 0) + 1 : 0
      streaks.set(id, streak)
      maxStreak = Math.max(maxStreak, streak)
      if (restingSet.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
    })
  })
  return { counts: [...counts.values()], maxStreak }
}

describe('precomputed planner primitives', () => {
  const metrics = (overrides: Partial<SocialPlannerMetrics> = {}): SocialPlannerMetrics => ({
    matches: 6,
    interOverOne: 0,
    intraOverTwo: 0,
    partnerRepeats: 0,
    opponentRepeats: 0,
    interOverTolerance: 0,
    intraOverOne: 0,
    maxInter: 0.2,
    maxIntra: 0.5,
    maxProjectedDebt: 0,
    squaredProjectedDebt: 0,
    genderPenalty: 0,
    engineScore: 0,
    ...overrides,
  })

  it('never buys a hard quality violation to improve repeats', () => {
    const safeWithRepeat = metrics({ partnerRepeats: 1 })
    const blowoutWithoutRepeat = metrics({ interOverOne: 1 })

    expect(isBetterSocialPlan(safeWithRepeat, blowoutWithoutRepeat)).toBe(true)
    expect(isBetterSocialPlan(blowoutWithoutRepeat, safeWithRepeat)).toBe(false)
  })

  it('prioritizes partner variety and per-player quality debt before soft averages', () => {
    expect(isBetterSocialPlan(
      metrics({ maxInter: 0.5 }),
      metrics({ partnerRepeats: 1, maxInter: 0.1 }),
    )).toBe(true)
    expect(isBetterSocialPlan(
      metrics({ maxProjectedDebt: 1, maxInter: 0.5 }),
      metrics({ maxProjectedDebt: 2, maxInter: 0.1 }),
    )).toBe(true)
  })

  it('counts repeat exposure on lineups over the configured PVNA tolerance', () => {
    const p1 = createPlayer('p1', { pvna: 4.5 })
    const p2 = createPlayer('p2', { pvna: 4.0 })
    const p3 = createPlayer('p3', { pvna: 3.8 })
    const p4 = createPlayer('p4', { pvna: 3.7 })
    setPartnerRepeats(p1, p2, 1)
    const state = createState({ pvnaTolerance: 0.5, players: [p1, p2, p3, p4] })

    const result = summarizeSessionPlanBoard(
      [{ team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] }],
      state,
      new Map([...state.players.keys()].map(id => [id, 0])),
    )

    expect(result.interOverTolerance).toBe(1)
    expect(result.partnerRepeats).toBe(1)
    expect(Number.isFinite(result.engineScore)).toBe(true)
  })

  it('limits opponent-repeat overflow before optimizing soft quality warnings', () => {
    expect(isBetterSocialPlan(
      metrics({ maxProjectedDebt: 0.4, opponentRepeats: 12, interOverTolerance: 1 }),
      metrics({ maxProjectedDebt: 0.1, opponentRepeats: 13 }),
    )).toBe(true)
  })

  it('optimizes soft quality before opponent repeats inside the repeat budget', () => {
    expect(isBetterSocialPlan(
      metrics({ maxProjectedDebt: 0.4, opponentRepeats: 12 }),
      metrics({ maxProjectedDebt: 0.1, opponentRepeats: 1, interOverTolerance: 1 }),
    )).toBe(true)
  })

  it('enforces repeat and preference caps independently of ranking', () => {
    const caps = { partnerRepeats: 1, opponentRepeats: 2, genderPenalty: 0 }
    expect(isWithinSocialPlannerCaps(metrics({ partnerRepeats: 1, opponentRepeats: 2 }), caps)).toBe(true)
    expect(isWithinSocialPlannerCaps(metrics({ opponentRepeats: 3 }), caps)).toBe(false)
    expect(isWithinSocialPlannerCaps(metrics({ genderPenalty: 1 }), caps)).toBe(false)
  })

  it('rejects unavailable, busy, reserved, and duplicate planned players', () => {
    const player = (id: string, overrides: Partial<PlayerSessionState> = {}): PlayerSessionState => ({
      player_id: id,
      pvna: 4,
      group_id: null,
      checked_in_at: new Date(0),
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
      gender: 'M',
      partner_gender_pref: 'any',
      opponent_gender_pref: 'any',
      rounds_available: 0,
      ...overrides,
    })
    const players = new Map([
      ['p1', player('p1')],
      ['p2', player('p2', { opted_rest: true })],
      ['p3', player('p3', { checked_out_at: new Date(1) })],
      ['p4', player('p4')],
      ['p5', player('p5')],
      ['p6', player('p6')],
    ])
    const result = validatePlannedBoard({
      matches: [
        { team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] },
        { team_a: ['p1', 'p5'], team_b: ['p6', 'missing'] },
      ],
      players,
      busyIds: new Set(['p4']),
      reservedIds: new Set(['p5']),
    })

    expect(result.valid).toBe(false)
    expect(result.invalidMatchIndexes).toEqual([0, 1])
    expect(result.violations.map(violation => violation.reason)).toEqual(expect.arrayContaining([
      'opted_rest',
      'checked_out',
      'busy',
      'duplicate_player',
      'reserved',
      'missing_player',
    ]))

    const repaired = repairUnavailablePlannedBoard({
      matches: [{ team_a: ['p1', 'p2'], team_b: ['p4', 'p6'] }],
      players,
    })
    expect(repaired.validation.valid).toBe(true)
    expect(repaired.changedMatchIndexes).toEqual([0])
    expect(repaired.replacements).toHaveLength(1)
    expect(repaired.board[0].team_a[0]).toBe('p1')
    expect(repaired.board[0].team_b).toEqual(['p4', 'p6'])
  })

  it('balances six-court rest counts without consecutive rests', () => {
    const players = Array.from({ length: 32 }, (_, index) => `p${index + 1}`)
    const schedule = buildBalancedRestSchedule(players, 8, 8)
    const metrics = restMetrics(players, schedule)

    expect(schedule).toHaveLength(8)
    expect(schedule.every(resting => resting.length === 8 && new Set(resting).size === 8)).toBe(true)
    expect(Math.max(...metrics.counts) - Math.min(...metrics.counts)).toBeLessThanOrEqual(1)
    expect(metrics.maxStreak).toBe(1)
  })

  it('meets the mathematical rest-streak bound when resting players are the majority', () => {
    const players = Array.from({ length: 36 }, (_, index) => `p${index + 1}`)
    const schedule = buildBalancedRestSchedule(players, 10, 20)
    const metrics = restMetrics(players, schedule)

    expect(minimumPossibleMaxRestStreak(36, 16)).toBe(2)
    expect(metrics.maxStreak).toBe(2)
    expect(Math.max(...metrics.counts) - Math.min(...metrics.counts)).toBeLessThanOrEqual(1)
  })

  it('resumes a rest schedule without changing the no-mutation suffix', () => {
    const players = Array.from({ length: 32 }, (_, index) => `p${index + 1}`)
    const full = buildBalancedRestSchedule(players, 8, 8)
    const prefix = full.slice(0, 3)
    const counts = new Map(players.map(id => [id, 0]))
    const streaks = new Map(players.map(id => [id, 0]))
    prefix.forEach(resting => {
      const restingSet = new Set(resting)
      players.forEach(id => streaks.set(id, restingSet.has(id) ? (streaks.get(id) ?? 0) + 1 : 0))
      resting.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
    })

    const resumed = buildBalancedRestSchedule(players, 5, 8, {
      startingRound: 3,
      initialRestCounts: counts,
      initialRestStreaks: streaks,
    })

    expect(resumed).toEqual(full.slice(3))
  })

  it('keeps deployable planner output identical to the proven diagnostic planner', () => {
    const rawPlayers = Array.from({ length: 24 }, (_, index) => ({
      player_id: `p${index + 1}`,
      checked_in_at: new Date(0).toISOString(),
      checked_out_at: null,
      effective_pvna: 2.5 + ((index * 37) % 101) / 100 * 3,
    }))
    const profiles = rawPlayers.map((player, index) => ({
      id: player.player_id,
      pvna: player.effective_pvna,
      gender: index % 2 === 0 ? 'male' : 'female',
    }))
    const state = buildInitialState(rawPlayers, profiles, 4)
    const diagnostic = buildShadowPrecomputedPlan(state, 3, 4, { localSearchPasses: 1 })
    const deployable = buildPrecomputedSessionPlan(state, 3, 4, { localSearchPasses: 1 })

    expect(deployable.rounds.map(({ round, resting, matches }) => ({ round, resting, matches })))
      .toEqual(diagnostic.schedule)
    expect(summarizeSessionPlan(deployable)).toEqual(aggregate(diagnostic.result))
  })

  it('builds the same pass-three plan one persisted round checkpoint at a time', () => {
    const players = Array.from({ length: 24 }, (_, index) => createPlayer(`p${index + 1}`, {
      effective_pvna: 2.5 + ((index * 37) % 101) / 100 * 3,
    }))
    const state = createState({ players, courts: 4, currentRound: 0 })
    const full = buildPrecomputedSessionPlan(state, 4, 4, { localSearchPasses: 3 })
    let checkpoint: SessionPlanChunkCheckpoint | null = null
    let result = buildPrecomputedSessionPlanChunk(state, 4, 4, checkpoint, { localSearchPasses: 3 })
    let chunks = 1

    while (!result.completed) {
      checkpoint = JSON.parse(JSON.stringify(result.checkpoint)) as SessionPlanChunkCheckpoint
      result = buildPrecomputedSessionPlanChunk(state, 4, 4, checkpoint, { localSearchPasses: 3 })
      chunks += 1
      if (chunks > 4) throw new Error('Session planner chunk did not converge')
    }

    expect(chunks).toBe(4)
    expect(result.plan).not.toBeNull()
    expect(result.plan!.rounds).toEqual(full.rounds)
    expect(result.plan!.invariants).toEqual(full.invariants)
    expect(summarizeSessionPlan(result.plan!)).toEqual(summarizeSessionPlan(full))
  })

  it('resumes deterministic pair-swap checkpoints to the same final board', () => {
    const initialBoard: PlannedBoardMatch[] = [
      { team_a: ['p1', 'p12'], team_b: ['p2', 'p11'] },
      { team_a: ['p3', 'p10'], team_b: ['p4', 'p9'] },
      { team_a: ['p5', 'p8'], team_b: ['p6', 'p7'] },
    ]
    const rating = (id: string) => Number(id.slice(1))
    const evaluate = (board: PlannedBoardMatch[]) => board.reduce((sum, match) => {
      const teamA = rating(match.team_a[0]) + rating(match.team_a[1])
      const teamB = rating(match.team_b[0]) + rating(match.team_b[1])
      return sum + Math.abs(teamA - teamB)
    }, 0)
    const full = runPairSwapSearch({
      initialBoard,
      passes: 2,
      evaluate,
      isBetter: (candidate, current) => candidate < current,
    })

    let checkpoint: PairSwapCheckpoint | undefined
    let chunked = runPairSwapSearch({
      initialBoard,
      passes: 2,
      evaluate,
      isBetter: (candidate, current) => candidate < current,
      maxCourtPairs: 1,
    })
    let chunks = 1
    while (!chunked.completed) {
      checkpoint = chunked.checkpoint ?? undefined
      chunked = runPairSwapSearch({
        initialBoard,
        passes: 2,
        evaluate,
        isBetter: (candidate, current) => candidate < current,
        checkpoint,
        maxCourtPairs: 1,
      })
      chunks += 1
      if (chunks > 20) throw new Error('Checkpoint search did not converge')
    }

    expect(chunks).toBeGreaterThan(1)
    expect(chunked.board).toEqual(full.board)
    expect(evaluate(chunked.board)).toBe(evaluate(full.board))
  })
})
