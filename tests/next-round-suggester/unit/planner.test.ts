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
  selectConsumablePlannedRollingPool,
  selectConsumablePlannedRoundPool,
  shouldExpandPlanAdoption,
} from '@/lib/next-round-suggester/planner/consumption'
import {
  plannedBoardEqualsLiveBoard,
  plannedMatchEqualsLiveMatch,
  plannedProgressMatches,
  resolvePlannedMatchAdvisory,
} from '@/lib/next-round-suggester/planner/advisory'
import {
  buildPlanningConfigIdentity,
  buildPlanningReplanIdentity,
  buildPlanningRosterIdentity,
  stablePlannerJson,
} from '@/lib/next-round-suggester/planner/identity'
import {
  buildPlanningFrontier,
  buildPlanningFrontierIdentity,
  getPlanningCommitments,
} from '@/lib/next-round-suggester/planner/frontier'
import {
  buildPrecomputedSessionPlan,
  buildPrecomputedSessionPlanChunk,
  resolveSessionPlanRoundCount,
  summarizeSessionPlan,
  summarizeSessionPlanBoard,
  type SessionPlanChunkCheckpoint,
} from '@/lib/next-round-suggester/planner/session-plan'
import type { PlayerSessionState, SessionLiveMatchRow } from '@/lib/next-round-suggester/types'
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
  const liveRow = (overrides: Partial<SessionLiveMatchRow> = {}): SessionLiveMatchRow => ({
    id: 'live-1',
    session_id: 'session-test',
    sequence_no: 1,
    round_no: 2,
    court_idx: 0,
    status: 'live',
    team_a: ['p1', 'p2'],
    team_b: ['p3', 'p4'],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    ended_at: null,
    ...overrides,
  })

  it('projects active commitments without mutating the authoritative state', () => {
    const state = createState({
      players: ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => createPlayer(id)),
      currentRound: 2,
    })
    const frontier = buildPlanningFrontier(state, [liveRow()])

    expect(state.players.get('p1')?.matches_played).toBe(0)
    expect(frontier.state.players.get('p1')?.matches_played).toBe(1)
    expect(frontier.state.players.get('p1')?.partner_counts.get('p2')).toBe(1)
    expect(frontier.state.players.get('p1')?.opponent_counts.get('p3')).toBe(1)
    expect(frontier.state.players.get('p5')?.consecutive_rest).toBe(0)
    expect(frontier.state.current_round).toBe(3)
    expect(frontier.busy_ids).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('advances the planning suffix past partially completed live rows', () => {
    const state = createState({
      players: ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id)),
      currentRound: 1,
    })
    const completed = liveRow({ status: 'completed', round_no: 1, ended_at: new Date(1).toISOString() })
    const frontier = buildPlanningFrontier(state, [completed])

    expect(frontier.state.current_round).toBe(2)
    expect(frontier.state.players.get('p1')?.matches_played).toBe(0)
    expect(frontier.identity.current_round).toBe(2)
    expect(frontier.identity.matches).toEqual([{ round_no: 1, lineup: 'p1|p2::p3|p4' }])
  })

  it('keeps frontier identity stable when a live commitment becomes completed history', () => {
    const state = createState({
      players: ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id)),
      currentRound: 2,
    })
    const row = liveRow()
    const liveIdentity = stablePlannerJson(buildPlanningFrontierIdentity(state, [row]))
    const completedState = buildPlanningFrontier(state, [row]).state
    const completedIdentity = stablePlannerJson(buildPlanningFrontierIdentity(completedState, []))

    expect(completedIdentity).toBe(liveIdentity)
  })

  it('changes frontier identity for a new, canceled, or repartitioned commitment', () => {
    const state = createState({
      players: ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id)),
      currentRound: 2,
    })
    const row = liveRow()
    const empty = stablePlannerJson(buildPlanningFrontierIdentity(state, []))
    const active = stablePlannerJson(buildPlanningFrontierIdentity(state, [row]))
    const repartitioned = stablePlannerJson(buildPlanningFrontierIdentity(state, [liveRow({
      team_a: ['p1', 'p3'],
      team_b: ['p2', 'p4'],
    })]))

    expect(active).not.toBe(empty)
    expect(repartitioned).not.toBe(active)
    expect(stablePlannerJson(buildPlanningFrontierIdentity(state, []))).toBe(empty)
  })

  it('keeps a plan valid across its own rolling start and completion progress', () => {
    const plannedByRound = new Map([[2, [{
      team_a: ['p1', 'p2'] as [string, string],
      team_b: ['p3', 'p4'] as [string, string],
    }]]])
    const plannedRow = liveRow({
      round_no: 1,
      suggestion_metadata: {
        preview_source: 'session_plan',
        plan_version_id: 'plan-1',
        planned_round_no: 2,
      },
    })

    expect(plannedProgressMatches({
      rows: [plannedRow],
      startingRound: 1,
      planVersionId: 'plan-1',
      plannedByRound,
    })).toBe(true)
    expect(plannedProgressMatches({
      rows: [{ ...plannedRow, status: 'completed' }],
      startingRound: 1,
      planVersionId: 'plan-1',
      plannedByRound,
    })).toBe(true)
    expect(plannedProgressMatches({
      rows: [{ ...plannedRow, suggestion_metadata: { preview_source: 'edge_committed' } }],
      startingRound: 1,
      planVersionId: 'plan-1',
      plannedByRound,
    })).toBe(false)
  })

  it('invalidates a plan when a baseline commitment is cancelled', () => {
    const baseline = liveRow({ id: 'baseline' })
    expect(plannedProgressMatches({
      rows: [{ ...baseline, status: 'cancelled' }],
      baselineCommitments: [baseline],
      startingRound: 3,
      planVersionId: 'plan-1',
      plannedByRound: new Map(),
    })).toBe(false)
  })

  it('locks manual suggested lineups but ignores ordinary suggestions', () => {
    const manual = liveRow({
      id: 'manual',
      status: 'suggested',
      suggestion_metadata: { manual_override: true },
    })
    expect(getPlanningCommitments([
      liveRow({ id: 'ordinary', status: 'suggested' }),
      manual,
    ]).map(row => row.id)).toEqual(['manual'])

    const state = createState({
      players: ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id)),
      currentRound: 2,
    })
    const frontier = buildPlanningFrontier(state, [manual])
    expect(frontier.pending_manual_suggestions.map(row => row.id)).toEqual(['manual'])
    expect(frontier.state.players.get('p1')?.matches_played).toBe(0)
    expect(frontier.state.players.get('p1')?.partner_counts.get('p2') ?? 0).toBe(0)
    expect(frontier.busy_ids).toEqual([])
  })

  it('plans a rolling suffix while courts are live and keeps busy consumption safe', () => {
    const players = Array.from({ length: 28 }, (_, index) => createPlayer(
      `p${String(index + 1).padStart(2, '0')}`,
      { pvna: 2.5 + index * 0.08 },
    ))
    const state = createState({ players, currentRound: 3, courts: 6 })
    const commitments = [
      liveRow({
        id: 'live-court-1',
        round_no: 3,
        court_idx: 0,
        team_a: ['p01', 'p02'],
        team_b: ['p03', 'p04'],
      }),
      liveRow({
        id: 'live-court-2',
        sequence_no: 2,
        round_no: 3,
        court_idx: 1,
        team_a: ['p05', 'p06'],
        team_b: ['p07', 'p08'],
      }),
    ]
    const frontier = buildPlanningFrontier(state, commitments)
    const plan = buildPrecomputedSessionPlan(frontier.state, 2, 6, {
      localSearchPasses: 1,
      startingRound: frontier.state.current_round,
    })

    expect(plan.invariants).toMatchObject({
      duplicate_player_rounds: 0,
      full_rounds: 2,
      expected_rounds: 2,
    })
    expect(plan.rounds.map(round => round.round)).toEqual([5, 6])
    const suffixCounts = new Map(players.map(player => [player.player_id, 0]))
    plan.rounds.forEach(round => round.matches.forEach(match => {
      ;[...match.team_a, ...match.team_b].forEach(playerId => (
        suffixCounts.set(playerId, (suffixCounts.get(playerId) ?? 0) + 1)
      ))
    }))
    const committedIds = new Set(commitments.flatMap(match => [...match.team_a, ...match.team_b]))
    expect([...committedIds].map(playerId => suffixCounts.get(playerId))).toEqual(Array(8).fill(1))
    expect(summarizeSessionPlan(plan)).toMatchObject({
      match_count_min: 2,
      match_count_max: 2,
    })
    const firstValidation = validatePlannedBoard({
      matches: plan.rounds[0].matches,
      players: state.players,
      busyIds: new Set(frontier.busy_ids),
    })
    const consumable = plan.rounds[0].matches.filter((_, index) => (
      !firstValidation.invalidMatchIndexes.includes(index)
    ))
    expect(validatePlannedBoard({
      matches: consumable,
      players: state.players,
      busyIds: new Set(frontier.busy_ids),
    }).valid).toBe(true)
  })

  it('keeps planning identity stable across ordinary round progress and busy state', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.5, effective_pvna: 3.7 }),
        createPlayer('p2', { pvna: 4 }),
        createPlayer('p3', { pvna: 4.2 }),
        createPlayer('p4', { pvna: 4.4 }),
      ],
    })
    const rosterIdentity = stablePlannerJson(buildPlanningRosterIdentity(state))
    const configIdentity = stablePlannerJson(buildPlanningConfigIdentity(state))

    state.current_round = 4
    const p1 = state.players.get('p1')!
    p1.matches_played = 4
    p1.last_played_round = 3
    p1.consecutive_play = 2
    p1.consecutive_rest = 0
    p1.rounds_available = 4
    p1.partner_counts.set('p2', 2)
    p1.opponent_counts.set('p3', 3)
    state.rounds.push({
      session_id: state.session_id,
      round_no: 3,
      status: 'completed',
      matches: [],
      resting: [],
      started_at: null,
      ended_at: null,
    })

    expect(stablePlannerJson(buildPlanningRosterIdentity(state))).toBe(rosterIdentity)
    expect(stablePlannerJson(buildPlanningConfigIdentity(state))).toBe(configIdentity)
  })

  it('invalidates planning identity for roster, preference, and config mutations', () => {
    const state = createState({ players: [createPlayer('p1'), createPlayer('p2')] })
    const rosterIdentity = stablePlannerJson(buildPlanningRosterIdentity(state))
    const configIdentity = stablePlannerJson(buildPlanningConfigIdentity(state))

    state.players.get('p1')!.opted_rest = true
    expect(stablePlannerJson(buildPlanningRosterIdentity(state))).not.toBe(rosterIdentity)
    state.players.get('p1')!.opted_rest = false
    state.players.get('p1')!.partner_gender_pref = 'F'
    expect(stablePlannerJson(buildPlanningRosterIdentity(state))).not.toBe(rosterIdentity)

    state.config.pvna_tolerance = 0.75
    expect(stablePlannerJson(buildPlanningConfigIdentity(state))).not.toBe(configIdentity)
  })

  it('supersedes coalesced replans for roster, config, frontier, and manual mutations', () => {
    const baseline = buildPlanningReplanIdentity({
      roster_fingerprint: 'roster-1',
      config_fingerprint: 'config-1',
      frontier_fingerprint: 'frontier-1',
      planning_mutation_version: 1,
    })

    expect(stablePlannerJson(buildPlanningReplanIdentity({
      ...baseline,
      planning_mutation_version: 2,
    }))).not.toBe(stablePlannerJson(baseline))
    expect(stablePlannerJson(buildPlanningReplanIdentity({
      ...baseline,
      active_manual_mutation_kind: 'lineup_override',
    }))).not.toBe(stablePlannerJson(baseline))
    expect(stablePlannerJson(buildPlanningReplanIdentity({
      ...baseline,
      frontier_fingerprint: 'frontier-2',
    }))).not.toBe(stablePlannerJson(baseline))
  })

  it('classifies planned matches without changing the live lineup', () => {
    const players = ['p1', 'p2', 'p3', 'p4'].map(id => createPlayer(id))
    const state = createState({ players })
    const planned = { team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] } as const

    expect(resolvePlannedMatchAdvisory({ plannedMatch: planned, state })).toMatchObject({
      status: 'usable',
      reasons: [],
    })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      busyIds: new Set(['p1']),
    })).toMatchObject({ status: 'repair_required', reasons: ['busy'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      reservedIds: new Set(['p2']),
    })).toMatchObject({ status: 'repair_required', reasons: ['reserved'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      rosterIdentityMatches: false,
    })).toMatchObject({ status: 'fallback', reasons: ['roster_changed'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      historyMatches: false,
    })).toMatchObject({ status: 'fallback', reasons: ['history_diverged'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      planningVersionMatches: false,
    })).toMatchObject({ status: 'fallback', reasons: ['planning_version_changed'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      frontierMatches: false,
    })).toMatchObject({ status: 'fallback', reasons: ['frontier_changed'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      planningVersionMatches: false,
      activeManualMutationKind: 'manual_team_repartition',
    })).toMatchObject({ status: 'fallback', reasons: ['manual_team_repartition'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: planned,
      state,
      planningVersionMatches: false,
      activeManualMutationKind: 'manual_player_replacement',
    })).toMatchObject({ status: 'fallback', reasons: ['manual_lineup_changed'] })
    expect(resolvePlannedMatchAdvisory({
      plannedMatch: { team_a: ['p1', 'p1'], team_b: ['p3', 'p4'] },
      state,
    })).toMatchObject({ status: 'fallback', reasons: ['duplicate_player'] })
    expect(resolvePlannedMatchAdvisory({ state })).toMatchObject({
      status: 'fallback',
      reasons: ['plan_missing'],
    })
  })

  it('assigns another feasible planned lineup when the same-index lineup is busy', () => {
    const state = createState({
      players: Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`)),
      currentRound: 1,
    })
    const matches = [
      { team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] },
      { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] },
    ]
    const selected = selectConsumablePlannedRoundPool({
      candidates: [{ court_idx: 0, live_round_no: 1, planned_round_no: 2, matches }],
      state,
      busyIds: new Set(['p1']),
    })

    expect(selected.accepted).toHaveLength(1)
    expect(selected.accepted[0]).toMatchObject({ court_idx: 0, planned_match_idx: 1, match: matches[1] })
    expect(selected.decisions[0]).toMatchObject({ status: 'usable', planned_match_idx: 1 })
  })

  it('does not consume the same planned lineup twice across rolling courts', () => {
    const state = createState({
      players: Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`)),
      currentRound: 1,
    })
    const matches = [
      { team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] },
      { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] },
    ]
    const selected = selectConsumablePlannedRoundPool({
      candidates: [
        { court_idx: 0, live_round_no: 1, planned_round_no: 2, matches },
        { court_idx: 1, live_round_no: 1, planned_round_no: 2, matches },
      ],
      consumedMatchIndexesByRound: new Map([[2, new Set([0])]]),
      state,
    })

    expect(selected.accepted).toHaveLength(1)
    expect(selected.accepted[0]).toMatchObject({ court_idx: 0, planned_match_idx: 1 })
    expect(selected.decisions[1]).toMatchObject({ status: 'fallback', reasons: ['plan_missing'] })
  })

  it('uses the nearest feasible future lineup when the next synchronized round is busy', () => {
    const state = createState({
      players: Array.from({ length: 12 }, (_, index) => createPlayer(`p${index + 1}`)),
      currentRound: 1,
    })
    const round2 = [
      { team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] },
    ]
    const round3 = [
      { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] },
    ]
    const selected = selectConsumablePlannedRollingPool({
      candidates: [{
        court_idx: 0,
        live_round_no: 1,
        preferred_planned_round_no: 2,
        rounds: [
          { planned_round_no: 2, matches: round2 },
          { planned_round_no: 3, matches: round3 },
        ],
      }],
      state,
      busyIds: new Set(['p1']),
    })

    expect(selected.accepted).toHaveLength(1)
    expect(selected.accepted[0]).toMatchObject({
      planned_round_no: 3,
      planned_match_idx: 0,
      match: round3[0],
    })
  })

  it('keeps rolling consumption unique across rounds and simultaneous idle lanes', () => {
    const state = createState({
      players: Array.from({ length: 12 }, (_, index) => createPlayer(`p${index + 1}`)),
      currentRound: 1,
    })
    const round2 = [
      { team_a: ['p1', 'p2'] as [string, string], team_b: ['p3', 'p4'] as [string, string] },
      { team_a: ['p5', 'p6'] as [string, string], team_b: ['p7', 'p8'] as [string, string] },
    ]
    const round3 = [
      { team_a: ['p9', 'p10'] as [string, string], team_b: ['p11', 'p12'] as [string, string] },
    ]
    const rounds = [
      { planned_round_no: 2, matches: round2 },
      { planned_round_no: 3, matches: round3 },
    ]
    const selected = selectConsumablePlannedRollingPool({
      candidates: [
        { court_idx: 0, live_round_no: 1, preferred_planned_round_no: 2, rounds },
        { court_idx: 1, live_round_no: 1, preferred_planned_round_no: 2, rounds },
      ],
      consumedMatchIndexesByRound: new Map([[2, new Set([0])]]),
      state,
    })

    expect(selected.accepted).toHaveLength(2)
    expect(selected.accepted.map(item => [item.planned_round_no, item.planned_match_idx])).toEqual([
      [2, 1],
      [3, 0],
    ])
    const ids = selected.accepted.flatMap(item => [...item.match.team_a, ...item.match.team_b])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not use future rolling lineups when planner identity is stale', () => {
    const state = createState({
      players: Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`)),
      currentRound: 1,
    })
    const selected = selectConsumablePlannedRollingPool({
      candidates: [{
        court_idx: 0,
        live_round_no: 1,
        preferred_planned_round_no: 2,
        rounds: [{
          planned_round_no: 3,
          matches: [{ team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] }],
        }],
      }],
      state,
      identityMatches: false,
    })

    expect(selected.accepted).toEqual([])
    expect(selected.decisions[0].status).toBe('fallback')
  })

  it('adopts a new plan across all open lanes when retained suggestions are from another source', () => {
    expect(shouldExpandPlanAdoption({
      planVersionId: 'plan-new',
      targetCourtIdxs: [5],
      openCourtIdxs: [0, 1, 2, 3, 4, 5],
      rows: [{
        status: 'suggested',
        court_idx: 0,
        suggestion_metadata: { preview_source: 'edge_committed' },
      }],
    })).toBe(true)
    expect(shouldExpandPlanAdoption({
      planVersionId: 'plan-new',
      targetCourtIdxs: [5],
      openCourtIdxs: [0, 1, 2, 3, 4, 5],
      rows: [{
        status: 'suggested',
        court_idx: 0,
        suggestion_metadata: { preview_source: 'session_plan', plan_version_id: 'plan-new' },
      }],
    })).toBe(false)
  })

  it('compares planned and live lineups independent of team orientation', () => {
    const planned = { team_a: ['p1', 'p2'], team_b: ['p3', 'p4'] } as const
    expect(plannedMatchEqualsLiveMatch(planned, {
      team_a: ['p4', 'p3'],
      team_b: ['p2', 'p1'],
    })).toBe(true)
    expect(plannedMatchEqualsLiveMatch(planned, {
      team_a: ['p1', 'p3'],
      team_b: ['p2', 'p4'],
    })).toBe(false)
    expect(plannedBoardEqualsLiveBoard([
      planned,
      { team_a: ['p5', 'p6'], team_b: ['p7', 'p8'] },
    ], [
      { team_a: ['p8', 'p7'], team_b: ['p6', 'p5'] },
      { team_a: ['p4', 'p3'], team_b: ['p2', 'p1'] },
    ])).toBe(true)
  })

  it('plans only the unplayed target-round suffix unless an explicit horizon is requested', () => {
    expect(resolveSessionPlanRoundCount(0, 8)).toBe(8)
    expect(resolveSessionPlanRoundCount(3, 8)).toBe(5)
    expect(resolveSessionPlanRoundCount(8, 8)).toBe(0)
    expect(resolveSessionPlanRoundCount(9, 8)).toBe(0)
    expect(resolveSessionPlanRoundCount(3, 8, 2)).toBe(2)
  })

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

  it('replans only rounds four through eight after a round-three checkout mutation', () => {
    const players = Array.from({ length: 24 }, (_, index) => createPlayer(`p${index + 1}`, {
      effective_pvna: 2.5 + ((index * 37) % 101) / 100 * 3,
    }))
    const initial = createState({ players, courts: 4, currentRound: 0 })
    const prefix = buildPrecomputedSessionPlan(initial, 3, 4, { localSearchPasses: 2 })
    const mutated = prefix.state
    const checkedOutId = prefix.rounds[2].matches[0].team_a[0]
    mutated.players.set(checkedOutId, {
      ...mutated.players.get(checkedOutId)!,
      checked_out_at: new Date('2026-07-14T12:00:00.000Z'),
    })
    const remainingRounds = resolveSessionPlanRoundCount(mutated.current_round, 8)
    const fullTail = buildPrecomputedSessionPlan(mutated, remainingRounds, 4, {
      localSearchPasses: 3,
      startingRound: mutated.current_round,
      initialDebt: prefix.debt,
    })
    let checkpoint: SessionPlanChunkCheckpoint | null = null
    let chunk = buildPrecomputedSessionPlanChunk(mutated, remainingRounds, 4, checkpoint, {
      localSearchPasses: 3,
      startingRound: mutated.current_round,
      initialDebt: prefix.debt,
    })
    while (!chunk.completed) {
      checkpoint = JSON.parse(JSON.stringify(chunk.checkpoint)) as SessionPlanChunkCheckpoint
      chunk = buildPrecomputedSessionPlanChunk(mutated, remainingRounds, 4, checkpoint, {
        localSearchPasses: 3,
        startingRound: mutated.current_round,
        initialDebt: prefix.debt,
      })
    }

    expect(mutated.current_round).toBe(3)
    expect(remainingRounds).toBe(5)
    expect(fullTail.rounds.map(round => round.round)).toEqual([4, 5, 6, 7, 8])
    expect(fullTail.rounds.flatMap(round => round.matches)
      .flatMap(match => [...match.team_a, ...match.team_b])).not.toContain(checkedOutId)
    expect(fullTail.invariants.full_rounds).toBe(5)
    expect(chunk.plan!.rounds).toEqual(fullTail.rounds)
    expect(summarizeSessionPlan(chunk.plan!)).toEqual(summarizeSessionPlan(fullTail))
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
