import { buildProjectedStateAfterLiveMatch } from '../../../lib/next-round-suggester/live-preview'
import { chooseRollingHorizonAlternative } from '../../../lib/next-round-suggester/planner/rolling-horizon'
import type { SessionLiveMatchRow, SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { createPlayers, createState } from '../helpers/factories'

function alternative(teamA: [string, string], teamB: [string, string], score = 0): SuggestionAlternative {
  return {
    matches: [{
      court_idx: 0,
      team_a: teamA,
      team_b: teamB,
      score,
      stats: {
        pvna_diff: score,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
        consecutive_play_penalty: 0,
      },
    }],
    resting: [],
    score,
    warnings: [],
    stats: {
      pvna_diff: score,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

function liveRow(
  id: string,
  courtIdx: number,
  teamA: [string, string],
  teamB: [string, string],
  startedAt: string,
): SessionLiveMatchRow {
  return {
    id,
    session_id: 'rolling-horizon-test',
    sequence_no: courtIdx + 1,
    round_no: 1,
    court_idx: courtIdx,
    status: 'live',
    team_a: teamA,
    team_b: teamB,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: startedAt,
    started_at: startedAt,
    ended_at: null,
  }
}

describe('rolling court-lane horizon', () => {
  it('prefers a slightly weaker immediate match when every completion order keeps a next lane feasible', () => {
    const state = createState({ players: createPlayers(20), courts: 3 })
    state.session_id = 'rolling-horizon-test'
    const fragile = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const resilient = alternative(['p05', 'p06'], ['p07', 'p08'], 0.1)
    const commitments = [
      liveRow('live-1', 1, ['p09', 'p10'], ['p11', 'p12'], '2026-07-16T12:00:00.000Z'),
      liveRow('live-2', 2, ['p13', 'p14'], ['p15', 'p16'], '2026-07-16T12:01:00.000Z'),
    ]
    const future = alternative(['p17', 'p18'], ['p19', 'p20'], 0.05)
    const observedBusy = new Set<string>()

    const choice = chooseRollingHorizonAlternative({
      candidates: [fragile, resilient],
      state,
      baseBusyIds: new Set(commitments.flatMap(row => [...row.team_a, ...row.team_b])),
      liveCommitments: commitments,
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: ({ busyIds }) => {
        busyIds.forEach(playerId => observedBusy.add(playerId))
        return busyIds.has('p01') ? null : future
      },
    })

    expect(choice?.alternative).toBe(resilient)
    expect(choice?.diagnostics.completion_orders).toBe(2)
    expect(choice?.diagnostics.horizon_events).toBe(2)
    expect(choice?.diagnostics.paths_without_future_match).toBe(0)
    expect(choice?.diagnostics.future_cache_hits).toBeGreaterThan(0)
    expect(choice?.diagnostics.selected_candidate_index).toBe(1)
    expect(choice?.diagnostics.best_rejected_candidate_index).toBe(0)
    expect(choice?.diagnostics.best_rejected_delta).toBeGreaterThan(0)
    expect(observedBusy).toContain('p09')
    expect(observedBusy).toContain('p13')
  })

  it('does not fabricate a choice when no court is still live', () => {
    const state = createState({ players: createPlayers(8), courts: 2 })
    expect(chooseRollingHorizonAlternative({
      candidates: [
        alternative(['p01', 'p02'], ['p03', 'p04']),
        alternative(['p05', 'p06'], ['p07', 'p08']),
      ],
      state,
      baseBusyIds: new Set(),
      liveCommitments: [],
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => null,
    })).toBeNull()
  })

  it('uses the session target to preserve scarce future opportunities without making it a hard constraint', () => {
    const players = createPlayers(20)
    players.slice(0, 4).forEach(player => { player.matches_played = 2 })
    const state = createState({ players, courts: 3 })
    const locallyBest = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const followsPlan = alternative(['p05', 'p06'], ['p07', 'p08'], 0.1)
    const commitments = [
      liveRow('live-1', 1, ['p09', 'p10'], ['p11', 'p12'], '2026-07-16T12:00:00.000Z'),
    ]
    const future = alternative(['p13', 'p14'], ['p15', 'p16'], 0.05)
    const choice = chooseRollingHorizonAlternative({
      candidates: [locallyBest, followsPlan],
      state,
      baseBusyIds: new Set(commitments.flatMap(row => [...row.team_a, ...row.team_b])),
      liveCommitments: commitments,
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => future,
      planTarget: {
        target_matches_by_player: Object.fromEntries(players.map(player => [
          player.player_id,
          player.player_id <= 'p04' ? 2 : 4,
        ])),
        preferred_team_gap: 0.5,
        preferred_intra_team_gap: 1,
      },
    })

    expect(choice?.alternative).toBe(followsPlan)
  })

  it('builds the bounded beam from the full Pareto frontier instead of the first alternatives', () => {
    const players = createPlayers(16)
    const pvnas: Record<string, number> = {
      p01: 2, p02: 5, p03: 2.5, p04: 4.5,
      p05: 2.4, p06: 4.6, p07: 3, p08: 3.8,
      p09: 3, p10: 3, p11: 3, p12: 3,
      p13: 3, p14: 3, p15: 3, p16: 3,
    }
    players.forEach(player => { player.pvna = pvnas[player.player_id] ?? 3 })
    const state = createState({ players, courts: 2 })
    const poorFirst = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const middlingSecond = alternative(['p05', 'p06'], ['p07', 'p08'], 0)
    const paretoBestLast = alternative(['p09', 'p10'], ['p11', 'p12'], 0)
    const commitment = liveRow(
      'live-1',
      1,
      ['p13', 'p14'],
      ['p15', 'p16'],
      '2026-07-16T12:00:00.000Z',
    )

    const choice = chooseRollingHorizonAlternative({
      candidates: [poorFirst, middlingSecond, paretoBestLast],
      candidateLimit: 1,
      state,
      baseBusyIds: new Set([...commitment.team_a, ...commitment.team_b]),
      liveCommitments: [commitment],
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => null,
    })

    expect(choice?.alternative).toBe(paretoBestLast)
    expect(choice?.diagnostics.candidate_count).toBe(3)
    expect(choice?.diagnostics.frontier_candidate_count).toBe(1)
    expect(choice?.diagnostics.evaluated_candidate_count).toBe(1)
  })

  it('does not trade a clean current match for a plan candidate outside the quality guard', () => {
    const players = createPlayers(16)
    players.forEach(player => {
      player.pvna = 3
      player.matches_played = player.player_id <= 'p04' ? 2 : 0
    })
    players.find(player => player.player_id === 'p05')!.pvna = 2
    players.find(player => player.player_id === 'p06')!.pvna = 5
    players.find(player => player.player_id === 'p07')!.pvna = 3
    players.find(player => player.player_id === 'p08')!.pvna = 2.6
    const state = createState({ players, courts: 2, pvnaTolerance: 0.5 })
    const clean = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const outsideGuard = alternative(['p05', 'p06'], ['p07', 'p08'], 0)
    const commitment = liveRow(
      'live-1',
      1,
      ['p09', 'p10'],
      ['p11', 'p12'],
      '2026-07-16T12:00:00.000Z',
    )

    const choice = chooseRollingHorizonAlternative({
      candidates: [clean, outsideGuard],
      candidateLimit: 2,
      qualityReference: clean,
      state,
      baseBusyIds: new Set([...commitment.team_a, ...commitment.team_b]),
      liveCommitments: [commitment],
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => alternative(['p13', 'p14'], ['p15', 'p16'], 0),
      planTarget: {
        target_matches_by_player: Object.fromEntries(players.map(player => [
          player.player_id,
          player.player_id >= 'p05' && player.player_id <= 'p08' ? 4 : 2,
        ])),
      },
    })

    expect(choice?.alternative).toBe(clean)
    expect(choice?.diagnostics.evaluated_candidate_count).toBe(1)
  })

  it('uses the next checkpoint instead of deferring balance until the final target', () => {
    const players = createPlayers(12)
    players.forEach(player => { player.pvna = 3 })
    const state = createState({ players, courts: 2 })
    const earlyGroup = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const checkpointGroup = alternative(['p05', 'p06'], ['p07', 'p08'], 0)
    const commitment = liveRow('live-1', 1, ['p09', 'p10'], ['p11', 'p12'], '2026-07-16T12:00:00.000Z')
    const finalPlayers = Object.fromEntries(players.map(player => [player.player_id, playerTarget(2)]))
    const checkpointPlayers = Object.fromEntries(players.map(player => [
      player.player_id,
      playerTarget(player.player_id >= 'p05' && player.player_id <= 'p08' ? 1 : 0),
    ]))

    const choice = chooseRollingHorizonAlternative({
      candidates: [earlyGroup, checkpointGroup],
      state,
      baseBusyIds: new Set([...commitment.team_a, ...commitment.team_b]),
      liveCommitments: [commitment],
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => alternative(['p01', 'p02'], ['p03', 'p04'], 0),
      planTarget: {
        target_matches_by_player: Object.fromEntries(players.map(player => [player.player_id, 2])),
        players: finalPlayers,
        checkpoints: [{
          progress_ratio: 0.25,
          completed_plan_rounds: 1,
          target_total_appearances: 4,
          players: checkpointPlayers,
        }],
      },
    })

    expect(choice?.alternative).toBe(checkpointGroup)
  })

  it('preserves flexible connector players when a less-flexible feasible lineup exists', () => {
    const players = createPlayers(16)
    players.forEach(player => { player.pvna = 3 })
    const state = createState({ players, courts: 2 })
    const connectorLineup = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const scarceLineup = alternative(['p05', 'p06'], ['p07', 'p08'], 0)
    const connectorVariant = alternative(['p01', 'p03'], ['p02', 'p04'], 0)
    const commitment = liveRow('live-1', 1, ['p13', 'p14'], ['p15', 'p16'], '2026-07-16T12:00:00.000Z')

    const choice = chooseRollingHorizonAlternative({
      candidates: [connectorLineup, scarceLineup, connectorVariant],
      state,
      baseBusyIds: new Set([...commitment.team_a, ...commitment.team_b]),
      liveCommitments: [commitment],
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => alternative(['p09', 'p10'], ['p11', 'p12'], 0),
    })

    expect(choice?.alternative).toBe(scarceLineup)
    expect(choice?.diagnostics.selected_flexibility_cost).toBeLessThan(2)
  })

  it('returns the best completed candidate when the anytime budget expires', () => {
    const players = createPlayers(12)
    players.forEach(player => { player.pvna = 3 })
    const state = createState({ players, courts: 2 })
    const first = alternative(['p01', 'p02'], ['p03', 'p04'], 0)
    const second = alternative(['p05', 'p06'], ['p07', 'p08'], 0)
    const commitment = liveRow('live-1', 1, ['p09', 'p10'], ['p11', 'p12'], '2026-07-16T12:00:00.000Z')
    let now = 0

    const choice = chooseRollingHorizonAlternative({
      candidates: [first, second],
      state,
      baseBusyIds: new Set([...commitment.team_a, ...commitment.team_b]),
      liveCommitments: [commitment],
      budgetMs: 15,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => null,
      now: () => {
        now += 5
        return now
      },
    })

    expect(choice?.alternative).toBe(first)
    expect(choice?.diagnostics.budget_exhausted).toBe(true)
    expect(choice?.diagnostics.evaluated_candidate_count).toBe(1)
  })

  it('branches on every possible next court without enumerating factorial orders', () => {
    const players = createPlayers(20)
    players.forEach(player => { player.pvna = 3 })
    const state = createState({ players, courts: 4 })
    const commitments = [
      liveRow('live-1', 1, ['p09', 'p10'], ['p11', 'p12'], '2026-07-16T12:00:00.000Z'),
      liveRow('live-2', 2, ['p13', 'p14'], ['p15', 'p16'], '2026-07-16T12:01:00.000Z'),
      liveRow('live-3', 3, ['p17', 'p18'], ['p19', 'p20'], '2026-07-16T12:02:00.000Z'),
    ]

    const choice = chooseRollingHorizonAlternative({
      candidates: [
        alternative(['p01', 'p02'], ['p03', 'p04'], 0),
        alternative(['p05', 'p06'], ['p07', 'p08'], 0),
      ],
      state,
      baseBusyIds: new Set(commitments.flatMap(row => [...row.team_a, ...row.team_b])),
      liveCommitments: commitments,
      budgetMs: 300,
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => null,
    })

    expect(choice?.diagnostics.completion_orders).toBe(3)
    expect(choice?.diagnostics.completion_orders).toBeLessThan(6)
  })
})

function playerTarget(matches: number) {
  return {
    matches,
    rests: 0,
    quality_debt: 0,
    partner_diversity: 0,
    opponent_diversity: 0,
    partner_repeat_exposure: 0,
    opponent_repeat_exposure: 0,
    max_consecutive_rest: 1,
    max_consecutive_play: 2,
  }
}
