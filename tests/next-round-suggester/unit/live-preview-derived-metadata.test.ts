import {
  dropStaleDerivedMetadata,
  repairSuggestedPayloadBatch,
} from '../../../lib/next-round-suggester/live-preview'
import type {
  SuggestionAlternative,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
} from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

function payload(courtIdx: number, teamA: [string, string], teamB: [string, string]) {
  return { court_idx: courtIdx, round_no: 0, team_a: teamA, team_b: teamB, resting: [] }
}

function choiceAlternative(teamA: [string, string], teamB: [string, string]): SuggestionAlternative {
  const stats = {
    pvna_diff: 0,
    partner_repeats: 0,
    opponent_repeats: 0,
    group_bonus: 0,
    gender_pref_penalty: 0,
    consecutive_play_penalty: 0,
  }
  return {
    matches: [{ court_idx: 0, team_a: teamA, team_b: teamB, score: 0, stats }],
    resting: [],
    score: 0,
    warnings: [],
    stats,
  }
}

function tradeoffChoice(
  id: SuggestionTradeoffChoiceId,
  teamA: [string, string],
  teamB: [string, string],
): SuggestionTradeoffChoice {
  return {
    id,
    label: id,
    alternative: choiceAlternative(teamA, teamB),
    metrics: {
      pvna_gap: 0,
      pvna_over_by: 0,
      intra_team_gap: 0,
      intra_team_over_by: 0,
      repeat_over_by: 0,
      affected_pairs: 0,
      affected_players: 0,
      max_partner_pair: 0,
      max_opponent_pair: 0,
      total_cost: 0,
    },
    explanation: [],
  }
}

const forcedTradeoff = (teamA: [string, string], teamB: [string, string]) => ({
  kind: 'repeat' as const,
  acceptRepeat: { team_a: teamA, team_b: teamB },
  acceptImbalance: { team_a: ['x1', 'x2'] as [string, string], team_b: ['x3', 'x4'] as [string, string] },
})

describe('dropStaleDerivedMetadata', () => {
  it('drops forced_tradeoff when acceptRepeat describes a lineup that is no longer seated', () => {
    const seated = {
      ...payload(0, ['a', 'b'], ['c', 'd']),
      forced_tradeoff: forcedTradeoff(['a', 'b'], ['c', 'e']),
      wait_rescue_options: [{ court_idx: 1, started_at: null }],
    }

    const result = dropStaleDerivedMetadata(seated)

    expect(result.forced_tradeoff).toBeUndefined()
    expect(result.wait_rescue_options).toBeUndefined()
  })

  it('keeps forced_tradeoff when acceptRepeat is the seated lineup with teams swapped', () => {
    const seated = {
      ...payload(0, ['a', 'b'], ['c', 'd']),
      forced_tradeoff: forcedTradeoff(['c', 'd'], ['a', 'b']),
      wait_rescue_options: [{ court_idx: 1, started_at: null }],
    }

    const result = dropStaleDerivedMetadata(seated)

    expect(result.forced_tradeoff).toBeDefined()
    expect(result.wait_rescue_options).toBeDefined()
  })

  it('drops tradeoff_choices when the recommended choice describes a lineup that is no longer seated', () => {
    const seated = {
      ...payload(0, ['a', 'b'], ['c', 'd']),
      tradeoff_choices: [
        tradeoffChoice('balanced', ['a', 'c'], ['b', 'd']),
        tradeoffChoice('reduce_repeat', ['a', 'd'], ['b', 'c']),
      ],
      recommended_tradeoff_choice: 'balanced' as SuggestionTradeoffChoiceId,
    }

    const result = dropStaleDerivedMetadata(seated)

    expect(result.tradeoff_choices).toBeUndefined()
    expect(result.recommended_tradeoff_choice).toBeUndefined()
  })

  it('keeps tradeoff_choices when the recommended choice is the seated lineup', () => {
    const seated = {
      ...payload(0, ['a', 'b'], ['c', 'd']),
      tradeoff_choices: [
        tradeoffChoice('balanced', ['a', 'b'], ['c', 'd']),
        tradeoffChoice('reduce_repeat', ['a', 'd'], ['b', 'c']),
      ],
      recommended_tradeoff_choice: 'balanced' as SuggestionTradeoffChoiceId,
    }

    const result = dropStaleDerivedMetadata(seated)

    expect(result.tradeoff_choices).toHaveLength(2)
    expect(result.recommended_tradeoff_choice).toBe('balanced')
  })
})

describe('repairSuggestedPayloadBatch tradeoff_choices retention', () => {
  it('keeps tradeoff_choices on a court whose lineup the batch repair did not change', () => {
    const state = createState({
      courts: 3,
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
        createPlayer('i', { pvna: 1.0 }),
        createPlayer('j', { pvna: 1.0 }),
        createPlayer('k', { pvna: 1.0 }),
        createPlayer('l', { pvna: 1.0 }),
      ],
    })
    const payloads = [
      { ...payload(0, ['a', 'b'], ['c', 'd']), round_no: 6 },
      { ...payload(1, ['e', 'f'], ['g', 'h']), round_no: 6 },
      {
        ...payload(2, ['i', 'j'], ['k', 'l']),
        round_no: 6,
        tradeoff_choices: [tradeoffChoice('balanced', ['i', 'j'], ['k', 'l'])],
        recommended_tradeoff_choice: 'balanced' as SuggestionTradeoffChoiceId,
      },
    ]

    const repaired = repairSuggestedPayloadBatch(payloads, state, 0.5)

    const lineupOf = (teamA: readonly string[], teamB: readonly string[]) =>
      [[...teamA].sort().join('+'), [...teamB].sort().join('+')].sort().join('|')
    const before = new Map(payloads.map(p => [p.court_idx, lineupOf(p.team_a, p.team_b)]))
    const untouched = repaired.filter(p => before.get(p.court_idx) === lineupOf(p.team_a, p.team_b))

    expect(untouched.map(p => p.court_idx)).toContain(2)
    const court2 = untouched.find(p => p.court_idx === 2)!
    expect(court2.tradeoff_choices).toHaveLength(1)
    expect(court2.recommended_tradeoff_choice).toBe('balanced')
  })
})
