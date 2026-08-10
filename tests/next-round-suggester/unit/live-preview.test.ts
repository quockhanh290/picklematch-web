import {
  buildPreviewBatchKey,
  buildSuggestedMatchPayloads,
  buildFinalPreviewBoard,
  getPreviewMatchesToPersist,
  deferLowViabilityRequiredIdsForCourt,
  getLivePreviewCourtBudgetMs,
  isLiveRoundFullyCompleted,
  warnLiveRoundProjectionDrift,
  buildLiveTierOverrides,
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildLiveTradeoffChoices,
  buildOverThresholdRepeatTradeoff,
  findConditionalLiveQualityRescue,
  findConditionalLiveQualityTradeoff,
  findUnifiedSocialTradeoffRescue,
  findStrictCleanLiveAlternative,
  hasFulfilledPreviewBoardReplacements,
  improvesPreviewBoardPvna,
  needsEarlyFullBoardPvnaRescue,
  repairAllIdlePayloadBatchParticipation,
  repairSuggestedPayloadBatch,
  resolvePreviewPersistenceScope,
  resolveLivePreviewFinalChoice,
  shouldRunReplacementFullBoardRescue,
} from '../../../lib/next-round-suggester/live-preview'
import type { SessionLiveMatchRow, SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { getRecentRepeatCost } from '../../../lib/next-round-suggester/score'
import { createPlayer, createPlayers, createState, setPartnerRepeats, setOpponentRepeats } from '../helpers/factories'
import { __setQualityCostModelOverrideForTests } from '../../../lib/next-round-suggester/quality-cost-flag'

function alternative(teamA: [string, string], teamB: [string, string], pvnaDiff: number): SuggestionAlternative {
  return {
    matches: [{
      court_idx: 0,
      team_a: teamA,
      team_b: teamB,
      score: pvnaDiff,
      stats: {
        pvna_diff: pvnaDiff,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
        consecutive_play_penalty: 0,
      },
    }],
    resting: [],
    score: pvnaDiff,
    warnings: [],
    stats: {
      pvna_diff: pvnaDiff,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

function liveMatch(teamA: [string, string], teamB: [string, string], roundNo = 0): SessionLiveMatchRow {
  return {
    id: `match-${roundNo}-${teamA.join('-')}-${teamB.join('-')}`,
    session_id: 'session-test',
    sequence_no: roundNo,
    round_no: roundNo,
    court_idx: 0,
    status: 'completed',
    team_a: teamA,
    team_b: teamB,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date('2026-05-14T12:00:00.000Z').toISOString(),
    started_at: null,
    ended_at: null,
  }
}

function liveRow(
  id: string,
  courtIdx: number,
  status: SessionLiveMatchRow['status'],
  teamA: [string, string],
  teamB: [string, string],
): SessionLiveMatchRow {
  return {
    id,
    session_id: 'session-test',
    sequence_no: courtIdx,
    round_no: 0,
    court_idx: courtIdx,
    status,
    team_a: teamA,
    team_b: teamB,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date('2026-05-14T12:00:00.000Z').toISOString(),
    started_at: status === 'live' ? new Date('2026-05-14T12:01:00.000Z').toISOString() : null,
    ended_at: status === 'completed' ? new Date('2026-05-14T12:15:00.000Z').toISOString() : null,
  }
}

function previewPayload(courtIdx: number, teamA: [string, string], teamB: [string, string]) {
  return {
    court_idx: courtIdx,
    round_no: 0,
    team_a: teamA,
    team_b: teamB,
    resting: [],
  }
}

describe('buildLiveTierOverrides', () => {
  it('lets hard per-court required players win over soft overplayed hints', () => {
    const result = buildLiveTierOverrides({
      fairnessTierOverrides: {},
      softOverplayedOverrides: { p1: Tier.SHOULD_REST },
      softUnderplayedOverrides: {},
      deferredRequiredIds: [],
      requiredForThisCourt: ['p1'],
    })

    expect(result.p1).toBe(Tier.MUST_PLAY)
  })

  it('lets deferred required players win over soft underplayed hints', () => {
    const result = buildLiveTierOverrides({
      fairnessTierOverrides: {},
      softOverplayedOverrides: {},
      softUnderplayedOverrides: { p1: Tier.SHOULD_PLAY },
      deferredRequiredIds: ['p1'],
      requiredForThisCourt: [],
    })

    expect(result.p1).toBe(Tier.FLEXIBLE)
  })

  it('lets hard per-court required players win over deferred required players', () => {
    const result = buildLiveTierOverrides({
      fairnessTierOverrides: {},
      softOverplayedOverrides: {},
      softUnderplayedOverrides: {},
      deferredRequiredIds: ['p1'],
      requiredForThisCourt: ['p1'],
    })

    expect(result.p1).toBe(Tier.MUST_PLAY)
  })
})

describe('getLivePreviewCourtBudgetMs', () => {
  it('divides remaining batch time while reserving minimum time for later courts', () => {
    expect(getLivePreviewCourtBudgetMs(3800, 4)).toBeCloseTo(687.5)
    expect(getLivePreviewCourtBudgetMs(3800, 1)).toBe(900)
    expect(getLivePreviewCourtBudgetMs(600, 3)).toBe(350)
  })
})

describe('buildPreviewBatchKey', () => {
  it('changes when a session-level effective PVNA override changes', () => {
    const state = createState({ players: createPlayers(4) })
    const fairnessAdjustment = { tier_overrides: {}, applied_for_warnings: [] }
    const original = buildPreviewBatchKey(state.session_id, state, 1, 0.5, fairnessAdjustment)

    state.players.get('p01')!.effective_pvna = 4.2

    expect(buildPreviewBatchKey(state.session_id, state, 1, 0.5, fairnessAdjustment)).not.toBe(original)
  })

  it('includes live quality policy so policy-specific preview caches cannot collide', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
      ],
    })
    const fairnessAdjustment = { tier_overrides: {}, applied_for_warnings: [] }

    const currentKey = buildPreviewBatchKey(
      state.session_id,
      state,
      1,
      0.5,
      fairnessAdjustment,
      'current',
    )
    const rescueKey = buildPreviewBatchKey(
      state.session_id,
      state,
      1,
      0.5,
      fairnessAdjustment,
      'pvna_outlier_rescue',
    )

    expect(rescueKey).not.toBe(currentKey)
    expect(buildPreviewBatchKey(state.session_id, state, 1, 0.5, fairnessAdjustment)).toBe(currentKey)
  })
})

describe('isLiveRoundFullyCompleted', () => {
  it('does not treat an async multi-court round as complete while one court is still live', () => {
    const matchesByRound = new Map<number, SessionLiveMatchRow[]>([
      [0, [
        liveRow('court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
        liveRow('court-1', 1, 'live', ['p5', 'p6'], ['p7', 'p8']),
      ]],
    ])

    expect(isLiveRoundFullyCompleted(0, matchesByRound, 2, new Set())).toBe(false)
  })

  it('treats a round as complete when the last live court is being completed', () => {
    const matchesByRound = new Map<number, SessionLiveMatchRow[]>([
      [0, [
        liveRow('court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
        liveRow('court-1', 1, 'live', ['p5', 'p6'], ['p7', 'p8']),
      ]],
    ])

    expect(isLiveRoundFullyCompleted(0, matchesByRound, 2, new Set(['court-1']))).toBe(true)
  })

  it('does not count suggested rows as completed courts', () => {
    const matchesByRound = new Map<number, SessionLiveMatchRow[]>([
      [0, [
        liveRow('court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
        liveRow('court-1', 1, 'suggested', ['p5', 'p6'], ['p7', 'p8']),
      ]],
    ])

    expect(isLiveRoundFullyCompleted(0, matchesByRound, 2, new Set())).toBe(false)
  })
})

describe('warnLiveRoundProjectionDrift', () => {
  it('warns only when live round projection diverges from committed state or current court capacity', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    warnLiveRoundProjectionDrift({
      source: 'lib',
      sessionId: 'session-test',
      stateCurrentRound: 1,
      projectedRoundNo: 1,
      projectedRoundMatchCount: 1,
      courtCapacity: 2,
      roundCounts: new Map([[1, 1]]),
      courtIdxsByRound: new Map([[1, new Set([0, 1])]]),
    })

    expect(warnSpy).not.toHaveBeenCalled()

    warnLiveRoundProjectionDrift({
      source: 'lib',
      sessionId: 'session-test',
      stateCurrentRound: 1,
      projectedRoundNo: 2,
      projectedRoundMatchCount: 0,
      courtCapacity: 3,
      roundCounts: new Map([[1, 2]]),
      courtIdxsByRound: new Map([[1, new Set([0, 1])]]),
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[next-round-suggester] live round projection drift monitor',
      expect.objectContaining({
        session_id: 'session-test',
        current_round_drift: true,
        court_capacity_drift: true,
      }),
    )

    warnSpy.mockRestore()
  })
})

describe('deferLowViabilityRequiredIdsForCourt', () => {
  it('keeps only required players with a near-level active candidate on non-final courts', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('r-low', { pvna: 2.5 }),
        createPlayer('r-high', { pvna: 4.5 }),
        createPlayer('near-low', { pvna: 2.8 }),
        createPlayer('far-1', { pvna: 3.4 }),
        createPlayer('far-2', { pvna: 3.5 }),
      ],
    })

    const result = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: ['r-low', 'r-high'],
      availableRequiredIds: ['r-low', 'r-high'],
      busyIds: new Set(),
      remainingCourtsInRound: 2,
      state,
    })

    expect(result).toEqual(['r-low'])
  })

  it('does not defer required players on the final court of a round', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('r-low', { pvna: 2.5 }),
        createPlayer('r-high', { pvna: 4.5 }),
        createPlayer('near-low', { pvna: 2.8 }),
      ],
    })

    const result = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: ['r-low', 'r-high'],
      availableRequiredIds: ['r-low', 'r-high'],
      busyIds: new Set(),
      remainingCourtsInRound: 1,
      state,
    })

    expect(result).toEqual(['r-low', 'r-high'])
  })

  it('does not run the defer heuristic when required PVNA spread is within tolerance', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('r1', { pvna: 2.5 }),
        createPlayer('r2', { pvna: 2.8 }),
        createPlayer('far', { pvna: 4.5 }),
      ],
    })

    const result = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: ['r1', 'r2'],
      availableRequiredIds: ['r1', 'r2'],
      busyIds: new Set(),
      remainingCourtsInRound: 2,
      state,
    })

    expect(result).toEqual(['r1', 'r2'])
  })

  it('never defers below the hard number of players required to preserve rest rotation', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('r-low', { pvna: 2.5 }),
        createPlayer('r-high', { pvna: 4.5 }),
        createPlayer('near-low', { pvna: 2.8 }),
        createPlayer('far-1', { pvna: 3.4 }),
        createPlayer('far-2', { pvna: 3.5 }),
      ],
    })

    const result = deferLowViabilityRequiredIdsForCourt({
      requiredForThisCourt: ['r-low', 'r-high'],
      availableRequiredIds: ['r-low', 'r-high'],
      busyIds: new Set(),
      remainingCourtsInRound: 2,
      minimumRequiredCount: 2,
      state,
    })

    expect(result).toEqual(['r-low', 'r-high'])
  })
})

describe('projected live match state', () => {
  it('applies fairness config changes before building live suggestions', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: {
        config_changes: {
          pvna_tolerance: 0.8,
          weights: { ...state.config.weights, partner_repeat: 99 },
        },
        tier_overrides: {},
        applied_for_warnings: ['partner_repeat'],
      },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].configured_pvna_tolerance).toBe(0.5)
    expect(payloads[0].effective_pvna_tolerance).toBe(0.8)
  })

  it('counts rest only when the projected logical round is finalized', () => {
    const state = createState({
      players: [
        createPlayer('p1'),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
        createPlayer('p5'),
      ],
    })

    const afterMatch = buildProjectedStateAfterLiveMatch(state, liveMatch(['p1', 'p2'], ['p3', 'p4']), 0)

    expect(afterMatch.players.get('p5')?.consecutive_rest).toBe(0)
    expect(afterMatch.players.get('p1')?.consecutive_play).toBe(1)

    const afterRound = buildProjectedStateAfterCompletedLiveRound(
      afterMatch,
      new Set(['p1', 'p2', 'p3', 'p4']),
    )

    expect(afterRound.players.get('p5')?.consecutive_rest).toBe(1)
    expect(afterRound.players.get('p5')?.consecutive_play).toBe(0)
    expect(afterRound.players.get('p1')?.consecutive_rest).toBe(0)
  })

  it('treats an existing active round as completed only in projected state for repeat scoring', () => {
    const state = createState({
      players: [
        createPlayer('p1'),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
        createPlayer('p5'),
        createPlayer('p6'),
      ],
    })
    state.rounds = [{
      session_id: 'session-test',
      round_no: 0,
      status: 'active',
      matches: [],
      resting: [],
      started_at: new Date('2026-05-14T12:00:00.000Z'),
      ended_at: null,
    }]

    const projectedState = buildProjectedStateAfterLiveMatch(
      state,
      liveMatch(['p1', 'p2'], ['p3', 'p4'], 0),
      0,
    )
    const repeatCost = getRecentRepeatCost(['p1', 'p2'], ['p5', 'p6'], projectedState, 1)

    expect(state.rounds[0].status).toBe('active')
    expect(projectedState.rounds[0].status).toBe('completed')
    expect(repeatCost.partner).toBeGreaterThan(0)
    expect(repeatCost.total).toBeGreaterThan(0)
  })

  it('does not keep completed finishing-match players busy when suggesting a replacement', () => {
    const state = createState({
      courts: 2,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 3.4 }),
        createPlayer('p6', { pvna: 3.5 }),
        createPlayer('p7', { pvna: 3.6 }),
        createPlayer('p8', { pvna: 3.7 }),
      ],
    })
    const completedCourt0 = liveRow('live-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4'])
    const liveCourt1 = liveRow('live-court-1', 1, 'live', ['p5', 'p6'], ['p7', 'p8'])

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 2,
      state,
      rows: { liveMatchRows: [completedCourt0, liveCourt1], liveStateVersion: 1 },
      completingLiveMatchIds: new Set([completedCourt0.id]),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { ignoreCapacityLock: false },
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(0)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
    expect(payloads[0].live_availability_context).toEqual({
      locked_player_count: 4,
      live_court_count: 1,
    })
  })

  it('defers surplus resters instead of force-packing a blowout onto the only open court', () => {
    // Two courts still live + one open court (async single-court fill, count=1).
    // Eight idle players rested last round -> all "required". The four highest-priority
    // resters are bimodal (2 high + 2 low PVNA) and every high/low cross pairing is
    // repeat-blocked, so forcing all four onto the open court can only relax tolerance
    // into a blowout (high+high vs low+low). The fix treats the two pending live courts
    // as future fill slots and forces only the single highest-priority rester, leaving
    // the pool free to form a balanced match and deferring the rest to the next fill.
    const high1 = createPlayer('H1', { pvna: 4.7, consecutive_rest: 2, matches_played: 2, last_played_round: 0 })
    const high2 = createPlayer('H2', { pvna: 4.6, consecutive_rest: 2, matches_played: 2, last_played_round: 0 })
    const low1 = createPlayer('L1', { pvna: 2.1, consecutive_rest: 2, matches_played: 2, last_played_round: 0 })
    const low2 = createPlayer('L2', { pvna: 2.2, consecutive_rest: 2, matches_played: 2, last_played_round: 0 })
    const mids = [3.4, 3.5, 3.6, 3.5].map((pvna, index) =>
      createPlayer(`M${index + 1}`, { pvna, consecutive_rest: 1, matches_played: 2, last_played_round: 0 }))
    const busy = Array.from({ length: 8 }, (_, index) =>
      createPlayer(`B${index + 1}`, { pvna: 3.5, matches_played: 2, last_played_round: 0 }))
    for (const highPlayer of [high1, high2]) {
      for (const lowPlayer of [low1, low2]) setPartnerRepeats(highPlayer, lowPlayer, 3)
    }

    const state = createState({
      courts: 6,
      pvnaTolerance: 0.5,
      players: [high1, high2, low1, low2, ...mids, ...busy],
    })

    // Two courts still live (round not yet full -> the open court keeps a large
    // remainingCourtsInRound, so the quota guard does not step in and the required-rester
    // forcing path is exercised, matching the real async session shape).
    const liveRows = [
      liveRow('live-court-4', 4, 'live', ['B1', 'B2'], ['B3', 'B4']),
      liveRow('live-court-5', 5, 'live', ['B5', 'B6'], ['B7', 'B8']),
    ]

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: liveRows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0], ignoreCapacityLock: true },
    })

    expect(payloads).toHaveLength(1)
    const selected = payloads[0]
    const selectedIds = [...selected.team_a, ...selected.team_b]
    // Never force all four repeat-blocked bimodal resters together (the only blowout path).
    const forcedBimodalFoursome = ['H1', 'H2', 'L1', 'L2'].every(id => selectedIds.includes(id))
    expect(forcedBimodalFoursome).toBe(false)
    // The chosen match stays balanced rather than a tolerance-relaxed blowout.
    const pvnaOf = (id: string) => state.players.get(id)!.pvna
    const gap = Math.abs(
      pvnaOf(selected.team_a[0]) + pvnaOf(selected.team_a[1])
      - pvnaOf(selected.team_b[0]) - pvnaOf(selected.team_b[1]),
    )
    expect(gap).toBeLessThan(2.0)
  })

  it('does not pull a deferred required skill-outlier back in during intra rescue', () => {
    // The owed pool is bimodal. Band-cap forces the low cluster and marks the high outliers deferred
    // as FLEXIBLE. The near-level filler is protected by the first live-selection pass, forcing an
    // intra-rescue retry; that retry must keep the deferred outliers FLEXIBLE instead of letting the
    // engine reclassify them as MUST_PLAY from consecutive_rest.
    const state = createState({
      courts: 3,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('A-low-1', { pvna: 2.00, consecutive_rest: 1, matches_played: 1, last_played_round: 0 }),
        createPlayer('B-low-2', { pvna: 2.10, consecutive_rest: 1, matches_played: 1, last_played_round: 0 }),
        createPlayer('C-low-3', { pvna: 2.20, consecutive_rest: 1, matches_played: 1, last_played_round: 0 }),
        createPlayer('Z-high-1', { pvna: 4.80, consecutive_rest: 1, matches_played: 1, last_played_round: 0 }),
        createPlayer('D-low-filler', { pvna: 2.15, consecutive_rest: 0, consecutive_play: 2, matches_played: 1 }),
        createPlayer('busy-1', { pvna: 3.00, matches_played: 1 }),
        createPlayer('busy-2', { pvna: 3.00, matches_played: 1 }),
        createPlayer('busy-3', { pvna: 3.00, matches_played: 1 }),
        createPlayer('busy-4', { pvna: 3.00, matches_played: 1 }),
      ],
    })
    const liveCourt = liveRow('live-court-1', 1, 'live', ['busy-1', 'busy-2'], ['busy-3', 'busy-4'])

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows: [liveCourt], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0] },
    })

    expect(payloads).toHaveLength(1)
    const selectedIds = new Set([...payloads[0].team_a, ...payloads[0].team_b])
    expect(selectedIds).toEqual(new Set(['A-low-1', 'B-low-2', 'C-low-3', 'D-low-filler']))
    expect(selectedIds.has('Z-high-1')).toBe(false)
  })

  it('does not mark same-court live players as cross-court locked', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
      ],
    })
    const liveCourt0 = liveRow('live-court-0', 0, 'live', ['p1', 'p2'], ['p3', 'p4'])

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [liveCourt0], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0] },
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(0)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
    expect(payloads[0].locked_player_ids).toBeUndefined()
  })

  it('does not report occupied live lanes as missing courts in debug dumps', () => {
    const state = createState({
      courts: 6,
      players: Array.from({ length: 24 }, (_, index) =>
        createPlayer(`p${index + 1}`, {
          pvna: 3 + (index % 8) * 0.05,
          matches_played: 1,
        }),
      ),
    })
    const liveRows = [
      liveRow('live-court-0', 0, 'live', ['p1', 'p2'], ['p3', 'p4']),
      liveRow('live-court-2', 2, 'live', ['p5', 'p6'], ['p7', 'p8']),
      liveRow('live-court-4', 4, 'live', ['p9', 'p10'], ['p11', 'p12']),
      liveRow('live-court-5', 5, 'live', ['p13', 'p14'], ['p15', 'p16']),
    ]
    const dumps: any[] = []

    const payloads = buildSuggestedMatchPayloads({
      count: 6,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: liveRows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: {
        ignoreCapacityLock: false,
        onIncompleteDump: dump => dumps.push(dump),
      },
    })

    expect(payloads).toHaveLength(2)
    expect(payloads.map(payload => payload.court_idx).sort()).toEqual([1, 3])
    expect(dumps).toHaveLength(1)
    expect(dumps[0].missing_courts).toEqual([])
    expect(dumps[0].payload.missing_courts).toEqual([])
    expect(dumps[0].payload.busy_player_ids).toHaveLength(16)
  })

  it('keeps persisted suggested rows locked until they are replaced or cancelled', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 3.4 }),
        createPlayer('p6', { pvna: 3.5 }),
        createPlayer('p7', { pvna: 3.6 }),
        createPlayer('p8', { pvna: 3.7 }),
      ],
    })
    const staleSuggested = {
      ...liveRow('stale-suggested', 0, 'suggested', ['p1', 'p2'], ['p3', 'p4']),
      suggested_at: '2026-05-14T11:00:00.000Z',
    }

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [staleSuggested], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].preview_countable_match_count).toBe(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p5', 'p6', 'p7', 'p8']))
  })

  it('reuses a physically open court when every court index already appears in the logical round', () => {
    const state = createState({
      courts: 2,
      players: Array.from({ length: 12 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.05, matches_played: 1 }),
      ),
    })
    const priorCompleted = {
      ...liveRow('prior-completed-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
      sequence_no: 0,
    }
    const liveCourt1 = {
      ...liveRow('live-court-1', 1, 'live', ['p5', 'p6'], ['p7', 'p8']),
      sequence_no: 1,
    }
    const currentCompletedCourt0 = {
      ...liveRow('current-completed-court-0', 0, 'completed', ['p9', 'p10'], ['p11', 'p12']),
      sequence_no: 2,
    }

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 2,
      state,
      rows: {
        liveMatchRows: [priorCompleted, liveCourt1, currentCompletedCourt0],
        liveStateVersion: 1,
      },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(0)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).not.toContain('p5')
  })

  it('lets a required rested player override soft live recycle protection', () => {
    const state = createState({
      courts: 2,
      players: [
        ...Array.from({ length: 8 }, (_, index) => createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.05 })),
        createPlayer('p9', { pvna: 3.2, consecutive_play: 2 }),
      ],
    })
    const rows = [
      { ...liveRow('round-0-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']), sequence_no: 0, round_no: 0, cycle_no: 0 },
      { ...liveRow('round-0-court-1', 1, 'completed', ['p5', 'p6'], ['p7', 'p8']), sequence_no: 1, round_no: 0, cycle_no: 0 },
      { ...liveRow('round-1-court-0', 0, 'live', ['p1', 'p2'], ['p3', 'p4']), sequence_no: 2, round_no: 1, cycle_no: 1 },
    ]

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 2,
      state,
      rows: { liveMatchRows: rows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [1], rollingHorizon: true },
    })

    expect(payloads).toHaveLength(1)
    expect([...payloads[0].team_a, ...payloads[0].team_b]).toContain('p9')
  })

  it('fills two rolling lanes without treating their logical cycle as a synchronization barrier', () => {
    const state = createState({
      courts: 6,
      players: Array.from({ length: 24 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + (index % 8) * 0.05 }),
      ),
    })
    const roundZero = Array.from({ length: 6 }, (_, courtIdx) => ({
      ...liveRow(
        `round-0-court-${courtIdx}`,
        courtIdx,
        'completed',
        [`p${courtIdx * 4 + 1}`, `p${courtIdx * 4 + 2}`] as [string, string],
        [`p${courtIdx * 4 + 3}`, `p${courtIdx * 4 + 4}`] as [string, string],
      ),
      sequence_no: courtIdx,
      round_no: 0,
      cycle_no: 0,
    }))
    const rows = [
      ...roundZero,
      { ...liveRow('round-1-court-0', 0, 'completed', ['p17', 'p18'], ['p19', 'p20']), sequence_no: 6, round_no: 1, cycle_no: 1 },
      { ...liveRow('round-1-court-3', 3, 'live', ['p1', 'p2'], ['p3', 'p4']), sequence_no: 7, round_no: 1, cycle_no: 1 },
      { ...liveRow('round-1-court-4', 4, 'live', ['p5', 'p6'], ['p7', 'p8']), sequence_no: 8, round_no: 1, cycle_no: 1 },
      { ...liveRow('round-1-court-5', 5, 'live', ['p9', 'p10'], ['p11', 'p12']), sequence_no: 9, round_no: 1, cycle_no: 1 },
      { ...liveRow('round-2-court-0', 0, 'live', ['p13', 'p14'], ['p15', 'p16']), sequence_no: 10, round_no: 2, cycle_no: 2 },
    ]

    const payloads = buildSuggestedMatchPayloads({
      count: 2,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: rows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [1, 2], rollingHorizon: true },
    })

    const selectedIds = payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])
    expect(payloads.map(payload => payload.court_idx)).toEqual([1, 2])
    expect(new Set(selectedIds).size).toBe(8)
    expect(selectedIds.every(id => Number(id.slice(1)) >= 17)).toBe(true)
  })

  it('does not reuse players across visible preview cards after projected round advances', () => {
    const state = createState({
      courts: 2,
      players: Array.from({ length: 8 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.1 }),
      ),
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 3,
      sessionId: state.session_id,
      courtCount: 2,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    const visiblePlayerIds = payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])
    expect(payloads).toHaveLength(2)
    expect(new Set(visiblePlayerIds).size).toBe(visiblePlayerIds.length)
  })

  it('continues filling the visible preview batch when enough non-overlapping players remain', () => {
    const state = createState({
      courts: 3,
      players: Array.from({ length: 12 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.1 }),
      ),
    })
    const completedCourt0 = liveRow('completed-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4'])
    const completedCourt1 = liveRow('completed-court-1', 1, 'completed', ['p5', 'p6'], ['p7', 'p8'])

    const payloads = buildSuggestedMatchPayloads({
      count: 3,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows: [completedCourt0, completedCourt1], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    const visiblePlayerIds = payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])
    expect(payloads).toHaveLength(3)
    expect(new Set(visiblePlayerIds).size).toBe(visiblePlayerIds.length)
  })

  it('uses stored live round numbers after court capacity changes mid-session', () => {
    const state = createState({
      courts: 3,
      players: [
        ...Array.from({ length: 8 }, (_, index) =>
          createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.1 }),
        ),
        ...Array.from({ length: 8 }, (_, index) =>
          createPlayer(`p${index + 9}`, {
            pvna: 3,
            consecutive_rest: index < 4 ? 3 : 0,
          }),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          createPlayer(`p${index + 17}`, { pvna: 3 + index * 0.1 }),
        ),
      ],
    })
    const liveMatchRows = [
      {
        ...liveRow('round-0-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
        sequence_no: 0,
        round_no: 0,
      },
      {
        ...liveRow('round-0-court-1', 1, 'completed', ['p5', 'p6'], ['p7', 'p8']),
        sequence_no: 1,
        round_no: 0,
      },
      {
        ...liveRow('round-1-court-0', 0, 'completed', ['p9', 'p10'], ['p11', 'p12']),
        sequence_no: 2,
        round_no: 1,
      },
      {
        ...liveRow('round-1-court-1', 1, 'completed', ['p13', 'p14'], ['p15', 'p16']),
        sequence_no: 3,
        round_no: 1,
      },
    ]

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    const selectedPlayerIds = new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b]))

    expect(payloads).toHaveLength(1)
    expect(payloads[0].round_no).toBe(1)
    for (const playerId of ['p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16']) {
      expect(selectedPlayerIds.has(playerId)).toBe(false)
    }
  })

  it('does not reuse same-round players when a lagging court trails newer lanes', () => {
    const state = createState({
      courts: 3,
      players: Array.from({ length: 20 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.02 }),
      ),
    })
    const liveMatchRows = [
      {
        ...liveRow('round-0-court-2', 2, 'completed', ['p17', 'p18'], ['p19', 'p20']),
        sequence_no: 2,
        round_no: 0,
      },
      {
        ...liveRow('round-1-court-0', 0, 'completed', ['p1', 'p2'], ['p3', 'p4']),
        sequence_no: 3,
        round_no: 1,
      },
      {
        ...liveRow('round-2-court-0', 0, 'live', ['p5', 'p6'], ['p7', 'p8']),
        sequence_no: 6,
        round_no: 2,
      },
    ]

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: {
        tier_overrides: Object.fromEntries(
          ['p1', 'p2', 'p3', 'p4'].map(playerId => [playerId, Tier.MUST_PLAY]),
        ),
        applied_for_warnings: [],
      },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [2] },
    })

    const selectedPlayerIds = new Set([...payloads[0].team_a, ...payloads[0].team_b])
    expect(payloads).toHaveLength(1)
    expect(payloads[0].round_no).toBe(1)
    for (const playerId of ['p1', 'p2', 'p3', 'p4']) {
      expect(selectedPlayerIds.has(playerId)).toBe(false)
    }
  })

  it('honors explicit replacement court indexes when retained previews occupy other lanes', () => {
    const state = createState({
      courts: 3,
      players: Array.from({ length: 12 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.1 }),
      ),
    })
    const retainedPreviewCourt0 = {
      ...liveRow('retained-preview-court-0', 0, 'suggested', ['p1', 'p2'], ['p3', 'p4']),
      suggested_at: new Date().toISOString(),
    }
    const completedCourt1 = liveRow('completed-court-1', 1, 'completed', ['p5', 'p6'], ['p7', 'p8'])
    const liveCourt2 = liveRow('live-court-2', 2, 'live', ['p9', 'p10'], ['p11', 'p12'])

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 3,
      state,
      rows: { liveMatchRows: [retainedPreviewCourt0, completedCourt1, liveCourt2], liveStateVersion: 1 },
      completingLiveMatchIds: new Set([completedCourt1.id]),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [1], ignoreCapacityLock: false },
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p5', 'p6', 'p7', 'p8']))
  })

  it('does not defer rest-one players beyond a single-court rolling request', () => {
    const state = createState({
      courts: 6,
      players: [
        createPlayer('rest-1', { pvna: 3.00, consecutive_rest: 1, matches_played: 2 }),
        createPlayer('rest-2', { pvna: 3.10, consecutive_rest: 1, matches_played: 2 }),
        createPlayer('rest-3', { pvna: 3.20, consecutive_rest: 1, matches_played: 2 }),
        createPlayer('rest-4', { pvna: 3.30, consecutive_rest: 1, matches_played: 2 }),
        createPlayer('fresh-1', { pvna: 3.00, matches_played: 3 }),
        createPlayer('fresh-2', { pvna: 3.10, matches_played: 3 }),
        createPlayer('fresh-3', { pvna: 3.20, matches_played: 3 }),
        createPlayer('fresh-4', { pvna: 3.30, matches_played: 3 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [4] },
    })

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(
      new Set(['rest-1', 'rest-2', 'rest-3', 'rest-4']),
    )
  })

  it('prioritizes players omitted from the previous logical round before counters catch up', () => {
    const state = createState({
      courts: 6,
      players: Array.from({ length: 32 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 }),
      ),
    })
    const previousRound = Array.from({ length: 6 }, (_, courtIdx) => {
      const first = courtIdx * 4 + 1
      return {
        ...liveRow(
          `round-0-court-${courtIdx}`,
          courtIdx,
          courtIdx === 0 ? 'completed' : 'live',
          [`p${first}`, `p${first + 1}`],
          [`p${first + 2}`, `p${first + 3}`],
        ),
        sequence_no: courtIdx,
        round_no: 0,
      } as SessionLiveMatchRow
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: previousRound, liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      options: { courtIdxs: [0] },
    })

    expect(payloads).toHaveLength(1)
    const selectedPlayerIds = [...payloads[0].team_a, ...payloads[0].team_b]
    expect(selectedPlayerIds).toHaveLength(4)
    expect(selectedPlayerIds.every(playerId => Number(playerId.slice(1)) >= 25)).toBe(true)
  })

  it('surfaces an intra-team tradeoff from the exact final lineup', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('high-1', { pvna: 4.80 }),
        createPlayer('high-2', { pvna: 4.20 }),
        createPlayer('low-1', { pvna: 2.10 }),
        createPlayer('low-2', { pvna: 2.80 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].warnings).toContain('INTRA_TEAM_GAP_RELAXED')
    expect(payloads[0].tradeoffs?.some(tradeoff => tradeoff.type === 'intra_team_gap_relaxed')).toBe(true)
    expect(payloads[0].approval_required).toBe(true)
  })

  it('builds a final preview board by replacing only requested courts', () => {
    const currentPreviewBoard = [
      previewPayload(0, ['p1', 'p2'], ['p3', 'p4']),
      previewPayload(1, ['p5', 'p6'], ['p7', 'p8']),
      previewPayload(2, ['p9', 'p10'], ['p11', 'p12']),
    ]
    const replacement = previewPayload(1, ['p13', 'p14'], ['p15', 'p16'])

    const result = buildFinalPreviewBoard({
      mode: 'replace_courts',
      payloads: [replacement],
      currentPreviewBoard,
      replacementCourtIdxs: [1],
      courtCount: 3,
    })

    expect(result.final_preview_board.map(payload => payload.court_idx)).toEqual([0, 1, 2])
    expect(result.locked_court_idxs).toEqual([0, 2])
    expect(result.replaced_court_idxs).toEqual([1])
    expect(result.final_preview_board[0]).toMatchObject(currentPreviewBoard[0])
    expect(result.final_preview_board[1]).toMatchObject(replacement)
    expect(result.final_preview_board[2]).toMatchObject(currentPreviewBoard[2])
  })

  it('persists only requested courts for a partial replacement', () => {
    const finalPreviewBoard = [
      previewPayload(0, ['p1', 'p2'], ['p3', 'p4']),
      previewPayload(1, ['p5', 'p6'], ['p7', 'p8']),
      previewPayload(2, ['p9', 'p10'], ['p11', 'p12']),
    ]

    expect(getPreviewMatchesToPersist({
      mode: 'replace_courts',
      finalPreviewBoard,
      replacementCourtIdxs: [1],
    }).map(match => match.court_idx)).toEqual([1])
    expect(getPreviewMatchesToPersist({
      mode: 'full_board',
      finalPreviewBoard,
      replacementCourtIdxs: [],
    })).toEqual(finalPreviewBoard)
  })

  it('promotes an accepted quality rescue to an atomic full-board replacement', () => {
    expect(resolvePreviewPersistenceScope({
      mode: 'replace_courts',
      qualityRescueUsed: true,
      requestedCourtIdxs: [1],
      openCourtIdxs: [1, 4, 5],
      replaceAllSuggestions: false,
    })).toEqual({
      mode: 'full_board',
      replace_court_idxs: [1, 4, 5],
      replace_all: true,
    })
  })

  it('keeps a normal court replacement scoped to the requested court', () => {
    expect(resolvePreviewPersistenceScope({
      mode: 'replace_courts',
      qualityRescueUsed: false,
      requestedCourtIdxs: [1],
      openCourtIdxs: [1, 4, 5],
      replaceAllSuggestions: false,
    })).toEqual({
      mode: 'replace_courts',
      replace_court_idxs: [1],
      replace_all: false,
    })
  })

  it('automatically rescues a severe replacement even without the client flag', () => {
    expect(shouldRunReplacementFullBoardRescue({
      mode: 'replace_courts',
      clientAllowsRescue: false,
      replacementBoardIncomplete: false,
      needsQualityRescue: true,
    })).toBe(true)
  })

  it('does not globally recompute an ordinary incomplete replacement without the client flag', () => {
    expect(shouldRunReplacementFullBoardRescue({
      mode: 'replace_courts',
      clientAllowsRescue: false,
      replacementBoardIncomplete: true,
      needsQualityRescue: false,
    })).toBe(false)
  })

  it('does not add a replacement that overlaps an earlier replacement', () => {
    const currentPreviewBoard = [
      previewPayload(0, ['p1', 'p2'], ['p3', 'p4']),
      previewPayload(1, ['p5', 'p6'], ['p7', 'p8']),
    ]
    const replacement = previewPayload(1, ['p9', 'p10'], ['p11', 'p12'])
    const overlappingReplacement = previewPayload(2, ['p9', 'p13'], ['p14', 'p15'])

    const result = buildFinalPreviewBoard({
      mode: 'replace_courts',
      payloads: [replacement, overlappingReplacement],
      currentPreviewBoard,
      replacementCourtIdxs: [1, 2],
      courtCount: 3,
    })

    expect(result.final_preview_board.map(payload => payload.court_idx)).toEqual([0, 1])
    expect(result.locked_court_idxs).toEqual([0])
    expect(result.replaced_court_idxs).toEqual([1])
  })

  it('prioritizes requested replacement courts over stale locked preview rows', () => {
    const currentPreviewBoard = [
      previewPayload(0, ['p1', 'p2'], ['p3', 'p4']),
      previewPayload(1, ['p5', 'p6'], ['p7', 'p8']),
    ]
    const replacements = [
      previewPayload(2, ['p9', 'p10'], ['p11', 'p12']),
      previewPayload(3, ['p1', 'p13'], ['p14', 'p15']),
    ]

    const result = buildFinalPreviewBoard({
      mode: 'replace_courts',
      payloads: replacements,
      currentPreviewBoard,
      replacementCourtIdxs: [2, 3],
      courtCount: 4,
    })

    expect(result.replaced_court_idxs).toEqual([2, 3])
    expect(result.locked_court_idxs).toEqual([1])
    expect(result.final_preview_board.map(payload => payload.court_idx)).toEqual([1, 2, 3])
  })

  it('detects when overlapping replacements leave a requested court unfilled', () => {
    const currentPreviewBoard = [
      previewPayload(0, ['p1', 'p2'], ['p3', 'p4']),
      previewPayload(1, ['p5', 'p6'], ['p7', 'p8']),
    ]
    const replacement = previewPayload(1, ['p9', 'p10'], ['p11', 'p12'])
    const overlappingReplacement = previewPayload(2, ['p9', 'p13'], ['p14', 'p15'])

    const result = buildFinalPreviewBoard({
      mode: 'replace_courts',
      payloads: [replacement, overlappingReplacement],
      currentPreviewBoard,
      replacementCourtIdxs: [1, 2],
      courtCount: 3,
    })

    expect(hasFulfilledPreviewBoardReplacements(result, [1, 2])).toBe(false)
    expect(hasFulfilledPreviewBoardReplacements(result, [])).toBe(true)
  })

  it('does not keep a severe PVNA outlier when the same four players can be repartitioned near the cap', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('low-1', { pvna: 2.28 }),
        createPlayer('low-2', { pvna: 3.50 }),
        createPlayer('high-1', { pvna: 4.95 }),
        createPlayer('high-2', { pvna: 4.44 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    const payload = payloads[0]
    const teamPvna = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    expect(Math.abs(teamPvna(payload.team_a) - teamPvna(payload.team_b))).toBeLessThan(1)
  })

  it('protects players with long consecutive-play streaks when enough fresh players are available', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('streak-1', { pvna: 3.00, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-2', { pvna: 3.02, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-3', { pvna: 3.04, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-4', { pvna: 3.06, matches_played: 2, consecutive_play: 2 }),
        createPlayer('fresh-1', { pvna: 2.10 }),
        createPlayer('fresh-2', { pvna: 2.40 }),
        createPlayer('fresh-3', { pvna: 4.60 }),
        createPlayer('fresh-4', { pvna: 4.90 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(
      new Set(['fresh-1', 'fresh-2', 'fresh-3', 'fresh-4']),
    )
    expect(payloads[0].warnings ?? []).not.toContain('LIVE_REPLACEMENT_RECYCLE_RELAXED')
  })

  it('surfaces a recycle-relaxed warning only when consecutive-play protection cannot fill a match', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('streak-1', { pvna: 3.00, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-2', { pvna: 3.10, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-3', { pvna: 3.20, matches_played: 2, consecutive_play: 2 }),
        createPlayer('streak-4', { pvna: 3.30, matches_played: 2, consecutive_play: 2 }),
        createPlayer('fresh-1', { pvna: 3.40 }),
        createPlayer('fresh-2', { pvna: 3.50 }),
        createPlayer('fresh-3', { pvna: 3.60 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].warnings ?? []).toContain('LIVE_REPLACEMENT_RECYCLE_RELAXED')
  })

  it('does not let MUST_PLAY force a fourth-or-more consecutive match when enough fresh players exist', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('streak-required', { pvna: 3.00, matches_played: 4, consecutive_play: 4 }),
        createPlayer('fresh-1', { pvna: 2.10 }),
        createPlayer('fresh-2', { pvna: 2.40 }),
        createPlayer('fresh-3', { pvna: 4.60 }),
        createPlayer('fresh-4', { pvna: 4.90 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: {
        tier_overrides: { 'streak-required': Tier.MUST_PLAY },
        applied_for_warnings: [],
      },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(
      new Set(['fresh-1', 'fresh-2', 'fresh-3', 'fresh-4']),
    )
  })

  it('allows a fourth consecutive match only when soft and hard recycle guards cannot fill a match', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('hard-streak', { pvna: 3.00, matches_played: 3, consecutive_play: 3 }),
        createPlayer('fresh-1', { pvna: 3.10 }),
        createPlayer('fresh-2', { pvna: 3.20 }),
        createPlayer('fresh-3', { pvna: 3.30 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(
      new Set(['hard-streak', 'fresh-1', 'fresh-2', 'fresh-3']),
    )
    expect(payloads[0].warnings ?? []).toContain('LIVE_REPLACEMENT_RECYCLE_HARD_RELAXED')
  })

  // PRODUCT CHANGE, not a stale test. This used to expect zero payloads: the engine held the streaked
  // player back and returned nothing. The anti-fatigue rule itself is unchanged and still wins by
  // default — only its presentation moved, from a silent empty court the host could not distinguish
  // from a broken engine, to a panel that names the streak and lets them override it.
  //
  // Here nothing is live, so no completion can ever free a substitute. Waiting would stall forever,
  // so the panel points at playing instead; the wait-by-default case is covered in
  // live-preview-fatigue-panel.test.ts, where a live court exists to wait for.
  it('surfaces a fifth consecutive match as a choice instead of a silent empty court', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('absolute-streak', { pvna: 3.00, matches_played: 4, consecutive_play: 4 }),
        createPlayer('fresh-1', { pvna: 3.10 }),
        createPlayer('fresh-2', { pvna: 3.20 }),
        createPlayer('fresh-3', { pvna: 3.30 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].forced_tradeoff?.kind).toBe('fatigue')
    expect(payloads[0].forced_tradeoff?.recommended).toBe('accept_repeat')
    expect(payloads[0].wait_rescue_options ?? []).toHaveLength(0)
  })

  it('relaxes the absolute consecutive-play guard when no substitute exists', () => {
    const state = createState({
      courts: 1,
      players: [
        createPlayer('absolute-1', { pvna: 3.00, matches_played: 4, consecutive_play: 4 }),
        createPlayer('absolute-2', { pvna: 3.10, matches_played: 4, consecutive_play: 4 }),
        createPlayer('absolute-3', { pvna: 3.20, matches_played: 4, consecutive_play: 4 }),
        createPlayer('absolute-4', { pvna: 3.30, matches_played: 4, consecutive_play: 4 }),
      ],
    })

    const payloads = buildSuggestedMatchPayloads({
      count: 1,
      sessionId: state.session_id,
      courtCount: 1,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
    })

    expect(payloads).toHaveLength(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(
      new Set(['absolute-1', 'absolute-2', 'absolute-3', 'absolute-4']),
    )
    expect(payloads[0].warnings ?? []).toContain('LIVE_RECYCLE_ABSOLUTE_RELAXED')
  })
})

describe('conditional live quality rescue', () => {
  it('selects a no-regression rescue that improves intra and streak burden', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.5, matches_played: 2, consecutive_play: 2 }),
        createPlayer('b', { pvna: 4.4, matches_played: 2, consecutive_play: 2 }),
        createPlayer('c', { pvna: 3.8, matches_played: 3, consecutive_play: 3 }),
        createPlayer('d', { pvna: 4.7, matches_played: 2, consecutive_play: 2 }),
        createPlayer('e', { pvna: 3.0, matches_played: 2, consecutive_play: 1 }),
        createPlayer('f', { pvna: 3.74, matches_played: 3, consecutive_play: 3 }),
        createPlayer('g', { pvna: 3.2, matches_played: 3, consecutive_play: 1 }),
        createPlayer('h', { pvna: 3.05, matches_played: 3, consecutive_play: 1 }),
      ],
    })
    const reference = alternative(['a', 'b'], ['c', 'd'], 0.4)
    const rescue = alternative(['e', 'f'], ['g', 'h'], 0.49)
    const worsensStreak = alternative(['c', 'f'], ['g', 'h'], 0.1)

    expect(findConditionalLiveQualityRescue(
      [worsensStreak, rescue],
      reference,
      state,
      0.5,
      25,
    )).toBe(rescue)
  })

  it('does not surface an extreme PVNA regression as an intra-team tradeoff', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.5 }),
        createPlayer('b', { pvna: 4.4 }),
        createPlayer('c', { pvna: 3.8 }),
        createPlayer('d', { pvna: 4.7 }),
        createPlayer('e', { pvna: 2.0 }),
        createPlayer('f', { pvna: 2.1 }),
        createPlayer('g', { pvna: 4.5 }),
        createPlayer('h', { pvna: 4.6 }),
      ],
    })
    const reference = alternative(['a', 'b'], ['c', 'd'], 0.4)
    const extreme = alternative(['e', 'f'], ['g', 'h'], 5.0)

    expect(buildLiveTradeoffChoices([reference, extreme], state, 0.5)).toBeNull()
  })

  it('offers a quality tradeoff instead of automatically worsening match-count quota', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.5, matches_played: 2 }),
        createPlayer('b', { pvna: 4.4, matches_played: 2 }),
        createPlayer('c', { pvna: 3.8, matches_played: 3 }),
        createPlayer('d', { pvna: 4.7, matches_played: 2 }),
        createPlayer('e', { pvna: 3.0, matches_played: 2 }),
        createPlayer('f', { pvna: 3.74, matches_played: 3, consecutive_play: 1 }),
        createPlayer('g', { pvna: 3.2, matches_played: 3 }),
        createPlayer('h', { pvna: 3.05, matches_played: 3 }),
      ],
    })
    const reference = alternative(['a', 'b'], ['c', 'd'], 0.4)
    const qualityTradeoff = alternative(['e', 'f'], ['g', 'h'], 0.49)

    expect(findConditionalLiveQualityRescue(
      [qualityTradeoff],
      reference,
      state,
      0.5,
      5,
    )).toBeNull()
    expect(findConditionalLiveQualityTradeoff(
      [qualityTradeoff],
      reference,
      state,
      0.5,
      5,
    )?.alternative).toBe(qualityTradeoff)
  })
})

describe('unified social tradeoff rescue', () => {
  function socialTradeoffFixture(overrides: { nearMatchesPlayed?: number } = {}) {
    const state = createState({
      courts: 6,
      currentRound: 3,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.30, matches_played: overrides.nearMatchesPlayed ?? 1 }),
        createPlayer('b', { pvna: 3.95, matches_played: 1 }),
        createPlayer('c', { pvna: 4.21, matches_played: 1 }),
        createPlayer('d', { pvna: 4.04, matches_played: 1 }),
        createPlayer('x', { pvna: 3.80, matches_played: 1 }),
        createPlayer('r1', { pvna: 4.75, matches_played: 1 }),
        createPlayer('r2', { pvna: 4.30, matches_played: 1 }),
        createPlayer('r3', { pvna: 3.95, matches_played: 1 }),
        createPlayer('r4', { pvna: 3.11, matches_played: 1 }),
      ],
    })
    state.rounds = [{
      session_id: state.session_id,
      round_no: 2,
      status: 'completed',
      matches: [{
        court_idx: 0,
        team_a: ['a', 'b'],
        team_b: ['c', 'x'],
      }],
      resting: [],
    }]
    return {
      state,
      reference: alternative(['r1', 'r2'], ['r3', 'r4'], 1.99),
      nearRematch: alternative(['a', 'b'], ['c', 'd'], 0),
      exactRematch: alternative(['a', 'b'], ['c', 'x'], 0.01),
    }
  }

  it('accepts a bounded near-rematch to rescue a catastrophic team gap', () => {
    const { state, reference, nearRematch, exactRematch } = socialTradeoffFixture()

    const rescue = findUnifiedSocialTradeoffRescue(
      [exactRematch, nearRematch],
      reference,
      state,
      0.5,
      3,
    )

    expect(rescue?.alternative.matches[0]).toMatchObject(nearRematch.matches[0])
    expect(rescue?.alternative.warnings).toContain('RECENT_GROUP_REMATCH_RELAXED')
    expect(rescue?.certificate).toMatchObject({
      reference_pvna_gap: 1.99,
      selected_pvna_gap: 0,
      selected_recent_overlap3: 1,
      selected_recent_exact4: 0,
    })
  })

  it('never selects an exact four-player rematch as the social rescue', () => {
    const { state, reference, exactRematch } = socialTradeoffFixture()

    expect(findUnifiedSocialTradeoffRescue(
      [exactRematch],
      reference,
      state,
      0.5,
      3,
    )).toBeNull()
  })

  it('does not rescue quality by increasing match-count quota debt', () => {
    const { state, reference, nearRematch } = socialTradeoffFixture({ nearMatchesPlayed: 2 })

    expect(findUnifiedSocialTradeoffRescue(
      [nearRematch],
      reference,
      state,
      0.5,
      3,
    )).toBeNull()
  })
})

describe('resolveLivePreviewFinalChoice', () => {
  it('uses conditional tradeoff choices only when the conditional baseline is the final guarded pick', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 3.0 }),
        createPlayer('b', { pvna: 3.1 }),
        createPlayer('c', { pvna: 3.2 }),
        createPlayer('d', { pvna: 3.3 }),
        createPlayer('e', { pvna: 3.0 }),
        createPlayer('f', { pvna: 3.2 }),
        createPlayer('g', { pvna: 3.4 }),
        createPlayer('h', { pvna: 3.6 }),
      ],
    })
    const baseline = alternative(['a', 'b'], ['c', 'd'], 0.1)
    const tradeoffAlternative = alternative(['e', 'f'], ['g', 'h'], 0.2)
    const metrics = {
      pvna_gap: 0.2,
      pvna_over_by: 0,
      intra_team_gap: 0.2,
      intra_team_over_by: 0,
      repeat_over_by: 0,
      affected_pairs: 0,
      affected_players: 0,
      max_partner_pair: 0,
      max_opponent_pair: 0,
      total_cost: 0.2,
    }

    const result = resolveLivePreviewFinalChoice({
      finalAlternatives: [baseline],
      baselineForConditionalSearch: baseline,
      conditionalQualityTradeoff: {
        alternative: tradeoffAlternative,
        metrics,
        quota: { total: 0, over: 0, under: 0 },
        burden: { max_streak: 0, streak_gte_3: 0, streak_gte_4: 0 },
        recent: 0,
        quota_over_delta: 1,
        opponent_repeat_delta: 0,
        consecutive_play_delta: 0,
      } as any,
      state,
      configuredPvnaTolerance: 0.5,
      nextMatchIndex: 1,
    })

    expect(result.finalGuardedAlternative).toBe(baseline)
    expect(result.usedConditionalTradeoff).toBe(true)
    expect(result.tradeoffChoices?.choices.map(choice => choice.alternative)).toEqual([
      baseline,
      tradeoffAlternative,
    ])
  })

  it('uses final alternatives when a prepended rescue is not the final guarded pick', () => {
    const state = createState({
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 3.0 }),
        createPlayer('b', { pvna: 3.1 }),
        createPlayer('c', { pvna: 3.2 }),
        createPlayer('d', { pvna: 3.3 }),
        createPlayer('e', { pvna: 4.0 }),
        createPlayer('f', { pvna: 4.1 }),
        createPlayer('g', { pvna: 3.0 }),
        createPlayer('h', { pvna: 3.1 }),
      ],
    })
    const staleBaseline = alternative(['e', 'f'], ['g', 'h'], 0.4)
    const prependedRescue = alternative(['e', 'g'], ['f', 'h'], 0.6)
    const finalPick = alternative(['a', 'b'], ['c', 'd'], 0.1)
    const metrics = {
      pvna_gap: 0.2,
      pvna_over_by: 0,
      intra_team_gap: 0.2,
      intra_team_over_by: 0,
      repeat_over_by: 0,
      affected_pairs: 0,
      affected_players: 0,
      max_partner_pair: 0,
      max_opponent_pair: 0,
      total_cost: 0.2,
    }

    const result = resolveLivePreviewFinalChoice({
      finalAlternatives: [prependedRescue, finalPick, staleBaseline],
      baselineForConditionalSearch: staleBaseline,
      conditionalQualityTradeoff: {
        alternative: prependedRescue,
        metrics,
        quota: { total: 0, over: 0, under: 0 },
        burden: { max_streak: 0, streak_gte_3: 0, streak_gte_4: 0 },
        recent: 0,
        quota_over_delta: 1,
        opponent_repeat_delta: 0,
        consecutive_play_delta: 0,
      } as any,
      state,
      configuredPvnaTolerance: 0.5,
      nextMatchIndex: 1,
    })

    expect(result.finalGuardedAlternative).toBe(finalPick)
    expect(result.usedConditionalTradeoff).toBe(false)
  })
})

describe('live preview batch repair', () => {
  it('repairs all-idle participation spread without dropping rest-required players', () => {
    const playerRows = [
      ['p1', 2.12, 4, 2], ['p2', 3.16, 4, 0], ['p3', 2.71, 3, 0], ['p4', 2.40, 4, 0],
      ['p5', 3.28, 4, 0], ['p6', 2.83, 4, 0], ['p7', 2.52, 5, 0], ['p8', 4.22, 3, 2],
      ['p9', 3.55, 4, 0], ['p10', 4.05, 4, 0], ['p11', 3.97, 4, 0], ['p12', 4.70, 3, 0],
      ['p13', 2.53, 4, 0], ['p14', 4.71, 3, 2], ['p15', 4.36, 5, 0], ['p16', 4.47, 3, 0],
      ['p17', 3.59, 3, 0], ['p18', 3.83, 4, 0], ['p19', 4.13, 4, 2], ['p20', 2.50, 4, 2],
      ['p21', 4.51, 4, 2], ['p22', 2.60, 4, 0], ['p23', 4.98, 3, 0], ['p24', 4.54, 3, 2],
      ['p25', 2.27, 4, 2], ['p26', 4.92, 3, 2], ['p27', 2.73, 4, 0], ['p28', 2.85, 4, 0],
      ['p29', 4.28, 4, 2], ['p30', 3.38, 3, 0], ['p31', 2.04, 4, 0], ['p32', 4.27, 4, 0],
    ] as const
    const players = playerRows.map(([id, pvna, matchesPlayed, consecutiveRest]) =>
      createPlayer(id, {
        pvna,
        matches_played: matchesPlayed,
        consecutive_rest: consecutiveRest,
      }))
    const state = createState({ courts: 6, currentRound: 5, players })
    const payloads = [
      previewPayload(0, ['p14', 'p24'], ['p23', 'p32']),
      previewPayload(1, ['p22', 'p20'], ['p27', 'p6']),
      previewPayload(2, ['p29', 'p8'], ['p21', 'p19']),
      previewPayload(3, ['p4', 'p3'], ['p28', 'p13']),
      previewPayload(4, ['p11', 'p2'], ['p17', 'p9']),
      previewPayload(5, ['p1', 'p18'], ['p26', 'p25']),
    ]
    const projectedSpread = (board: typeof payloads) => {
      const selected = new Set(board.flatMap(payload => [...payload.team_a, ...payload.team_b]))
      const counts = players.map(player =>
        player.matches_played + (selected.has(player.player_id) ? 1 : 0)
      )
      return Math.max(...counts) - Math.min(...counts)
    }
    const started = performance.now()
    const repaired = repairAllIdlePayloadBatchParticipation(payloads, state, 0.5)
    const selected = new Set(repaired.flatMap(payload => [...payload.team_a, ...payload.team_b]))
    const required = players
      .filter(player => player.consecutive_rest >= 1)
      .map(player => player.player_id)

    expect(projectedSpread(payloads)).toBe(2)
    expect(projectedSpread(repaired)).toBe(1)
    expect(required.every(playerId => selected.has(playerId))).toBe(true)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('requests an early full-board rescue only when it improves a bad replacement', () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.2 }),
        createPlayer('b', { pvna: 4.0 }),
        createPlayer('c', { pvna: 3.6 }),
        createPlayer('d', { pvna: 3.7 }),
        createPlayer('e', { pvna: 3.0 }),
        createPlayer('f', { pvna: 3.0 }),
        createPlayer('g', { pvna: 3.0 }),
        createPlayer('h', { pvna: 3.0 }),
      ],
    })
    const badReplacement = [{ ...previewPayload(0, ['a', 'b'], ['c', 'd']), round_no: 4 }]
    const rescuedBoard = [
      { ...previewPayload(0, ['a', 'c'], ['b', 'd']), round_no: 4 },
      { ...previewPayload(1, ['e', 'f'], ['g', 'h']), round_no: 4 },
    ]

    expect(needsEarlyFullBoardPvnaRescue(badReplacement, state, 0.5)).toBe(true)
    expect(improvesPreviewBoardPvna(rescuedBoard, badReplacement, state, 0.5)).toBe(true)
  })

  it('requests a full-board rescue for severe PVNA outliers in late rounds', () => {
    const state = createState({
      courts: 1,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.8 }),
        createPlayer('b', { pvna: 4.1 }),
        createPlayer('c', { pvna: 3.1 }),
        createPlayer('d', { pvna: 2.3 }),
      ],
    })
    const severeLateReplacement = [
      { ...previewPayload(0, ['a', 'b'], ['c', 'd']), round_no: 6 },
    ]

    expect(needsEarlyFullBoardPvnaRescue(severeLateReplacement, state, 0.5)).toBe(true)
  })

  it('repairs severe full-board PVNA outliers in late rounds', () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.8 }),
        createPlayer('b', { pvna: 4.1 }),
        createPlayer('c', { pvna: 3.1 }),
        createPlayer('d', { pvna: 2.3 }),
        createPlayer('e', { pvna: 4.7 }),
        createPlayer('f', { pvna: 4.0 }),
        createPlayer('g', { pvna: 3.0 }),
        createPlayer('h', { pvna: 2.2 }),
      ],
    })
    const payloads = [
      { ...previewPayload(0, ['a', 'b'], ['c', 'd']), round_no: 6 },
      { ...previewPayload(1, ['e', 'f'], ['g', 'h']), round_no: 6 },
    ]
    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5)
    const teamPvna = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    const gaps = repaired.map(payload => Math.abs(teamPvna(payload.team_a) - teamPvna(payload.team_b)))

    expect(Math.max(...gaps)).toBeLessThan(1.5)
  })

  it('uses the initial cross-court swap to reduce a non-severe PVNA outlier without changing who plays', () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.0 }),
        createPlayer('b', { pvna: 3.0 }),
        createPlayer('c', { pvna: 3.0 }),
        createPlayer('d', { pvna: 2.6 }),
        createPlayer('e', { pvna: 2.8 }),
        createPlayer('f', { pvna: 3.0 }),
        createPlayer('g', { pvna: 3.4 }),
        createPlayer('h', { pvna: 3.4 }),
      ],
    })
    const payloads = [
      { ...previewPayload(0, ['a', 'b'], ['c', 'd']), round_no: 6 },
      { ...previewPayload(1, ['e', 'f'], ['g', 'h']), round_no: 6 },
    ]
    const teamPvna = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    const maxGap = (batch: typeof payloads) =>
      Math.max(...batch.map(payload => Math.abs(teamPvna(payload.team_a) - teamPvna(payload.team_b))))

    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5, undefined, {
      allowEarlyQualityRepair: false,
    })

    expect(maxGap(payloads)).toBeCloseTo(1.4)
    expect(maxGap(repaired)).toBeLessThanOrEqual(0.5)
    expect(new Set(repaired.flatMap(payload => [...payload.team_a, ...payload.team_b]))).toEqual(
      new Set(payloads.flatMap(payload => [...payload.team_a, ...payload.team_b])),
    )
    expect(repaired).not.toEqual(payloads)
  })

  it('repairs a severe PVNA outlier before preserving intra-team comfort', () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 4.11 }),
        createPlayer('b', { pvna: 4.68 }),
        createPlayer('c', { pvna: 3.95 }),
        createPlayer('d', { pvna: 2.42 }),
        createPlayer('e', { pvna: 3.20 }),
        createPlayer('f', { pvna: 3.25 }),
        createPlayer('g', { pvna: 3.30 }),
        createPlayer('h', { pvna: 3.35 }),
      ],
    })
    const payloads = [
      previewPayload(0, ['a', 'b'], ['c', 'd']),
      previewPayload(1, ['e', 'f'], ['g', 'h']),
    ]

    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5)
    const teamPvna = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    const gaps = repaired.map(payload => Math.abs(teamPvna(payload.team_a) - teamPvna(payload.team_b)))

    expect(Math.max(...gaps)).toBeLessThan(1.5)
  })

  it('tracks PVNA cap overflow inside the early-round beam search', () => {
    const state = createState({
      courts: 2,
      pvnaTolerance: 0.5,
      players: [
        createPlayer('a', { pvna: 3.3 }),
        createPlayer('b', { pvna: 2.3 }),
        createPlayer('c', { pvna: 2.3 }),
        createPlayer('d', { pvna: 4.5 }),
        createPlayer('e', { pvna: 3.0 }),
        createPlayer('f', { pvna: 3.0 }),
        createPlayer('g', { pvna: 3.0 }),
        createPlayer('h', { pvna: 3.0 }),
      ],
    })
    const payloads = [
      { ...previewPayload(0, ['a', 'b'], ['c', 'd']), round_no: 3 },
      { ...previewPayload(1, ['e', 'f'], ['g', 'h']), round_no: 3 },
    ]

    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5)
    const teamPvna = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    const gaps = repaired.map(payload => Math.abs(teamPvna(payload.team_a) - teamPvna(payload.team_b)))

    expect(Math.max(...gaps)).toBeLessThan(1.18)
    expect(gaps.filter(gap => gap > 0.5)).toHaveLength(1)
  })

  it('repairs early-round intra-team outliers without exceeding the PVNA cap', () => {
    const state = createState({
      courts: 2,
      players: [
        createPlayer('p1', { pvna: 1.0 }),
        createPlayer('p2', { pvna: 2.8 }),
        createPlayer('p3', { pvna: 1.8 }),
        createPlayer('p4', { pvna: 2.0 }),
        createPlayer('p5', { pvna: 1.4 }),
        createPlayer('p6', { pvna: 1.6 }),
        createPlayer('p7', { pvna: 1.5 }),
        createPlayer('p8', { pvna: 1.5 }),
      ],
      pvnaTolerance: 0.5,
    })
    const payloads = [
      {
        court_idx: 0,
        team_a: ['p1', 'p2'],
        team_b: ['p3', 'p4'],
        resting: [],
        round_no: 1,
      },
      {
        court_idx: 1,
        team_a: ['p5', 'p6'],
        team_b: ['p7', 'p8'],
        resting: [],
        round_no: 1,
      },
    ] as any

    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5)
    const teamSum = (team: [string, string]) =>
      team.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
    const intraGap = (team: [string, string]) =>
      Math.abs((state.players.get(team[0])?.pvna ?? 0) - (state.players.get(team[1])?.pvna ?? 0))

    expect(repaired).not.toEqual(payloads)
    expect(new Set(repaired.flatMap(payload => [...payload.team_a, ...payload.team_b]))).toEqual(
      new Set(payloads.flatMap((payload: any) => [...payload.team_a, ...payload.team_b])),
    )
    repaired.forEach((payload) => {
      expect(Math.abs(teamSum(payload.team_a) - teamSum(payload.team_b))).toBeLessThanOrEqual(0.5)
      expect(Math.max(intraGap(payload.team_a), intraGap(payload.team_b))).toBeLessThanOrEqual(1.5)
    })
  })
})

describe('findStrictCleanLiveAlternative', () => {
  it('rescues a strict-clean match from available players before using soft-rest players', () => {
    const state = createState({
      players: [
        createPlayer('fresh-1', { pvna: 3.71 }),
        createPlayer('fresh-2', { pvna: 3.53 }),
        createPlayer('fresh-3', { pvna: 3.46 }),
        createPlayer('fresh-4', { pvna: 3.80 }),
        createPlayer('fresh-5', { pvna: 4.93 }),
        createPlayer('fresh-6', { pvna: 4.04 }),
        createPlayer('soft-rest-1', { pvna: 2.20, matches_played: 1, consecutive_play: 1 }),
        createPlayer('soft-rest-2', { pvna: 2.30, matches_played: 1, consecutive_play: 1 }),
      ],
      pvnaTolerance: 0.5,
    })

    const rescued = findStrictCleanLiveAlternative(state, {
      busyIds: new Set(),
      courtIdx: 0,
      configuredPvnaTolerance: 0.5,
      tierOverrides: {
        'soft-rest-1': Tier.SHOULD_REST,
        'soft-rest-2': Tier.SHOULD_REST,
      },
      timeoutMs: 300,
    })

    expect(rescued).not.toBeNull()
    expect(rescued?.tradeoffs).toEqual([])
    expect(rescued?.warnings).not.toContain('INTRA_TEAM_GAP_RELAXED')

    const selectedIds = new Set([
      ...(rescued?.matches[0]?.team_a ?? []),
      ...(rescued?.matches[0]?.team_b ?? []),
    ])
    expect(selectedIds.has('soft-rest-1')).toBe(false)
    expect(selectedIds.has('soft-rest-2')).toBe(false)
    expect(rescued?.matches[0]?.stats?.pvna_diff).toBeLessThanOrEqual(0.5)
  })
})

describe('buildLiveTradeoffChoices', () => {
  it('does not show tradeoff choices when displayed options are all within caps', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
    ]
    const state = createState({ players, pvnaTolerance: 0.5 })

    const choices = buildLiveTradeoffChoices([
      alternative(['p1', 'p2'], ['p3', 'p4'], 0.4),
      alternative(['p1', 'p3'], ['p2', 'p5'], 0.5),
      alternative(['p2', 'p3'], ['p4', 'p6'], 0.3),
    ], state, 0.5)

    expect(choices).toBeNull()
  })

  it('prefers a soft intra-team gap over a repeat overflow for the balanced choice', () => {
    const p1 = createPlayer('p1', { pvna: 3.0 })
    const p2 = createPlayer('p2', { pvna: 3.4 })
    const p3 = createPlayer('p3', { pvna: 3.7 })
    const p4 = createPlayer('p4', { pvna: 4.1 })
    setPartnerRepeats(p1, p2, 2)
    const state = createState({ players: [p1, p2, p3, p4], pvnaTolerance: 2.0 })
    const softIntraNoRepeat = alternative(['p1', 'p4'], ['p2', 'p3'], 0)
    const cleanIntraRepeat = alternative(['p1', 'p2'], ['p3', 'p4'], 0)

    const choices = buildLiveTradeoffChoices([
      cleanIntraRepeat,
      softIntraNoRepeat,
    ], state, 2.0)
    const balanced = choices?.choices.find(choice => choice.id === 'balanced')

    expect(choices?.recommended).toBe('balanced')
    expect(balanced?.alternative).toBe(softIntraNoRepeat)
    expect(balanced?.metrics.intra_team_over_by).toBeCloseTo(0.35)
    expect(balanced?.metrics.repeat_over_by).toBe(0)
  })

  it('recommends a PVNA-safe alternative instead of a lower-cost PVNA overflow', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 5.0 }),
        createPlayer('p6', { pvna: 5.1 }),
      ],
      pvnaTolerance: 0.5,
    })
    const lowCostPvnaOverflow = alternative(['p1', 'p2'], ['p3', 'p4'], 0.6)
    const highIntraPvnaSafe = alternative(['p1', 'p5'], ['p2', 'p6'], 0.4)

    const choices = buildLiveTradeoffChoices([
      lowCostPvnaOverflow,
      highIntraPvnaSafe,
    ], state, 0.5)
    const recommended = choices?.choices.find(choice => choice.id === choices.recommended)

    expect(recommended?.alternative).toBe(highIntraPvnaSafe)
    expect(recommended?.metrics.pvna_over_by).toBe(0)
    expect(recommended?.metrics.intra_team_over_by).toBeGreaterThan(0)
  })

  it('recommends the smallest PVNA overflow when every alternative exceeds the cap', () => {
    const state = createState({
      players: [
        createPlayer('p1', { pvna: 3.0 }),
        createPlayer('p2', { pvna: 3.1 }),
        createPlayer('p3', { pvna: 3.2 }),
        createPlayer('p4', { pvna: 3.3 }),
        createPlayer('p5', { pvna: 5.0 }),
        createPlayer('p6', { pvna: 5.1 }),
      ],
      pvnaTolerance: 0.5,
    })
    const largerPvnaOverflow = alternative(['p1', 'p2'], ['p3', 'p4'], 0.9)
    const smallerPvnaOverflow = alternative(['p1', 'p5'], ['p2', 'p6'], 0.6)

    const choices = buildLiveTradeoffChoices([
      largerPvnaOverflow,
      smallerPvnaOverflow,
    ], state, 0.5)
    const recommended = choices?.choices.find(choice => choice.id === choices.recommended)

    expect(recommended?.alternative).toBe(smallerPvnaOverflow)
    expect(recommended?.metrics.pvna_over_by).toBeCloseTo(0.1)
  })
})

describe('buildOverThresholdRepeatTradeoff — host tier-2 balance/freshness toggle', () => {
  afterEach(() => {
    __setQualityCostModelOverrideForTests(null)
  })

  function balanceFreshnessFixture() {
    const a = createPlayer('a', { pvna: 3.0 })
    const b = createPlayer('b', { pvna: 3.0 })
    const c = createPlayer('c', { pvna: 3.45 })
    const d = createPlayer('d', { pvna: 3.45 })
    const e = createPlayer('e', { pvna: 3.0 })
    const f = createPlayer('f', { pvna: 3.0 })
    const g = createPlayer('g', { pvna: 3.1 })
    const h = createPlayer('h', { pvna: 3.1 })
    setOpponentRepeats(e, g, 1)
    const state = createState({
      players: [a, b, c, d, e, f, g, h],
      pvnaTolerance: 1.0,
    })
    // fresh (no prior meetings) but the more imbalanced team gap of the two
    const fresherMoreImbalanced = alternative(['a', 'b'], ['c', 'd'], 0.9)
    // a repeat-2 (e/g have met once before), but the more balanced team gap of the two
    const balancedRepeatTwo = alternative(['e', 'f'], ['g', 'h'], 0.2)
    return { state, fresherMoreImbalanced, balancedRepeatTwo }
  }

  it('offers the balanced repeat-2 alternative alongside the fresher pick when the quality-cost model is ON', () => {
    __setQualityCostModelOverrideForTests(true)
    const { state, fresherMoreImbalanced, balancedRepeatTwo } = balanceFreshnessFixture()

    const result = buildOverThresholdRepeatTradeoff(
      fresherMoreImbalanced,
      [fresherMoreImbalanced, balancedRepeatTwo],
      state,
      1.0,
    )

    expect(result).not.toBeNull()
    const offeredAlternatives = result?.choices.map(choice => choice.alternative)
    expect(offeredAlternatives).toContain(fresherMoreImbalanced)
    expect(offeredAlternatives).toContain(balancedRepeatTwo)
  })

  it('does not offer a repeat-2 alternative when the quality-cost model is OFF (legacy repeat>=3 gate only)', () => {
    __setQualityCostModelOverrideForTests(false)
    const { state, fresherMoreImbalanced, balancedRepeatTwo } = balanceFreshnessFixture()

    const result = buildOverThresholdRepeatTradeoff(
      fresherMoreImbalanced,
      [fresherMoreImbalanced, balancedRepeatTwo],
      state,
      1.0,
    )

    expect(result).toBeNull()
  })
})
