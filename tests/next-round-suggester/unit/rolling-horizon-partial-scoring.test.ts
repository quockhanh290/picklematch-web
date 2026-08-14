import { createSearchBudget } from '../../../lib/next-round-suggester/search-budget'
import { buildProjectedStateAfterLiveMatch } from '../../../lib/next-round-suggester/live-preview'
import { chooseRollingHorizonAlternative } from '../../../lib/next-round-suggester/planner/rolling-horizon'
import type { SessionLiveMatchRow, SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { createPlayers, createState } from '../helpers/factories'

// BUG #21. Each candidate is scored over several simulated completion orders, as
// `average + worst * 0.5`. When the budget runs out mid-candidate the loop breaks and the candidate is
// scored on the paths it managed — so one candidate is judged over eight futures and the next over two.
//
// That does not merely add noise, it biases: the worst of two futures is almost always milder than the
// worst of eight, so the candidate that was measured LESS gets the better score and wins for having been
// examined less. The winner ends up decided by where the clock happened to fall.
//
// The rule: never compare a partial estimate against a full one. A candidate cut short is dropped rather
// than scored — unless nothing was fully evaluated, in which case a partial answer still beats none.
describe('a candidate cut short by the budget does not compete against fully scored ones', () => {
  const players = createPlayers(16)
  const state = createState({ courts: 4, pvnaTolerance: 0.5, players })

  const alternative = (teamA: [string, string], teamB: [string, string], score: number): SuggestionAlternative => ({
    matches: [{ court_idx: 0, team_a: teamA, team_b: teamB, score, stats: zero(score) }],
    resting: [], score, warnings: [], stats: zero(score),
  })

  function zero(score: number) {
    return {
      pvna_diff: score, partner_repeats: 0, opponent_repeats: 0,
      group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0,
    }
  }

  const commitments: SessionLiveMatchRow[] = [1, 2, 3].map(courtIdx => ({
    id: `m${courtIdx}`, session_id: state.session_id, sequence_no: courtIdx, round_no: 1,
    court_idx: courtIdx, status: 'live',
    team_a: [players[courtIdx * 4].player_id, players[courtIdx * 4 + 1].player_id],
    team_b: [players[courtIdx * 4 + 2].player_id, players[courtIdx * 4 + 3].player_id],
    resting: [], score_a: 0, score_b: 0,
    suggested_at: new Date(courtIdx * 1000).toISOString(),
    started_at: new Date(courtIdx * 1000).toISOString(),
    ended_at: null,
  } as SessionLiveMatchRow))

  const first = alternative([players[0].player_id, players[1].player_id],
    [players[2].player_id, players[3].player_id], 1)
  const second = alternative([players[0].player_id, players[2].player_id],
    [players[1].player_id, players[3].player_id], 1)

  const chooseWith = (cutAtCall: number) => {
    let calls = 0
    return chooseRollingHorizonAlternative({
      candidates: [first, second],
      state,
      baseBusyIds: new Set(commitments.flatMap(row => [...row.team_a, ...row.team_b])),
      liveCommitments: commitments,
      budget: createSearchBudget(10000),
      projectMatch: buildProjectedStateAfterLiveMatch,
      suggestFuture: () => null,
      now: () => {
        calls += 1
        return calls < cutAtCall ? 0 : 10_000
      },
    } as never) as never as { alternative: SuggestionAlternative } | null
  }

  it('picks the same candidate whether or not the clock cuts the search short', () => {
    // A clock that never expires: every candidate is scored over the full order set.
    const unhurried = chooseWith(Number.MAX_SAFE_INTEGER)
    // Expiring on the 14th reading lands partway through the second candidate's futures. Before the fix
    // that candidate was scored on what it had managed and lost to a fully scored rival — the winner
    // changed with the clock, which is the defect.
    const interrupted = chooseWith(14)

    expect(unhurried?.alternative).toBeDefined()
    expect(interrupted?.alternative).toBe(unhurried?.alternative)
  })
})
