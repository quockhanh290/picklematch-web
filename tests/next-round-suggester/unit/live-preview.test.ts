import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
  buildLiveTradeoffChoices,
} from '../../../lib/next-round-suggester/live-preview'
import type { SessionLiveMatchRow, SuggestionAlternative } from '../../../lib/next-round-suggester/types'
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
