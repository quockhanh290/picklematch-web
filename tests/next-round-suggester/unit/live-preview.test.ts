import {
  buildSuggestedMatchPayloads,
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildLiveTradeoffChoices,
  findStrictCleanLiveAlternative,
} from '../../../lib/next-round-suggester/live-preview'
import type { SessionLiveMatchRow, SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer, createState, setPartnerRepeats } from '../helpers/factories'

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

describe('projected live match state', () => {
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
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(0)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
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

  it('honors explicit replacement court indexes when retained previews occupy other lanes', () => {
    const state = createState({
      courts: 3,
      players: Array.from({ length: 12 }, (_, index) =>
        createPlayer(`p${index + 1}`, { pvna: 3 + index * 0.1 }),
      ),
    })
    const retainedPreviewCourt0 = liveRow('retained-preview-court-0', 0, 'suggested', ['p1', 'p2'], ['p3', 'p4'])
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
      options: { courtIdxs: [1] },
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].court_idx).toBe(1)
    expect(new Set([...payloads[0].team_a, ...payloads[0].team_b])).toEqual(new Set(['p5', 'p6', 'p7', 'p8']))
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

  it('waits instead of creating a fifth consecutive match', () => {
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

    expect(payloads).toHaveLength(0)
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
