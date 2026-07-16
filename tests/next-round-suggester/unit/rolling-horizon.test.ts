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
})
