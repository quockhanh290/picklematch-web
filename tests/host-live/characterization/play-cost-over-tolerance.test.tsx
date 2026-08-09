// READ-ONLY audit repro (scratch): SuggestedLiveMatchCard "Chơi luôn" cost line.
import { render } from '@testing-library/react-native'
import React from 'react'

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}), rpc: () => ({}), auth: {} } }))

import { SuggestedLiveMatchCard } from '@/features/host/session-detail/next-round-v2/components/ScreenComponents'
import type { PlayerSessionState, SessionState, SuggestionAlternative, SuggestionTradeoffChoice } from '@/lib/next-round-suggester/types'
import type { SuggestedLiveMatchRow } from '@/lib/next-round-suggester/live-preview'
import type { ArrangementPlayer } from '@/lib/sessionDetail'

const PVNA: Record<string, number> = {
  p1: 4.0, p2: 4.0,   // team A = 8.00
  p3: 3.6, p4: 3.55,  // team B = 7.15  -> gap 0.85, tol 0.5 -> over 0.35 (< blowout floor 1.5)
  p5: 3.8, p6: 3.4,
}

function player(id: string): PlayerSessionState {
  return {
    player_id: id,
    pvna: PVNA[id],
    group_id: null,
    checked_in_at: new Date('2026-08-01T00:00:00Z'),
    checked_out_at: null,
    matches_played: 2,
    last_played_round: 1,
    consecutive_rest: 0,
    consecutive_play: 1,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: 'male',
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
    rounds_available: 5,
  }
}

const state: SessionState = {
  session_id: 's1',
  current_round: 3,
  status: 'playing',
  config: {
    courts: 2,
    pvna_tolerance: 0.5,
    weights: {} as never,
  },
  players: new Map(Object.keys(PVNA).map(id => [id, player(id)])),
  rounds: [],
}

const playersById = new Map<string, ArrangementPlayer>(
  Object.keys(PVNA).map(id => [id, { id, name: id.toUpperCase(), pvna: PVNA[id] } as ArrangementPlayer]),
)

function alt(teamA: [string, string], teamB: [string, string]): SuggestionAlternative {
  return {
    matches: [{ court_idx: 1, team_a: teamA, team_b: teamB }],
    resting: ['p5', 'p6'],
    score: 1,
    warnings: [],
    tradeoffs: [],
    approval_required: false,
    stats: {
      pvna_diff: 0, partner_repeats: 0, opponent_repeats: 0,
      group_bonus: 0, gender_pref_penalty: 0, consecutive_play_penalty: 0,
    },
  }
}

// recommended ('balanced') = seated lineup: PVNA gap 0.85 > tol 0.5 (over_by 0.35),
// but NOT a blowout (gap < 1.5 floor) => engine leaves degraded_reason undefined.
// max_opponent_pair = 2 (< 3).
const balanced: SuggestionTradeoffChoice = {
  id: 'balanced',
  label: 'Tốt nhất tổng thể',
  alternative: alt(['p1', 'p2'], ['p3', 'p4']),
  metrics: {
    pvna_gap: 0.85, pvna_over_by: 0.35,
    intra_team_gap: 0.05, intra_team_over_by: 0,
    repeat_over_by: 0, affected_pairs: 0, affected_players: 0,
    max_partner_pair: 1, max_opponent_pair: 2, total_cost: 0.35,
  },
  explanation: [],
}

const reduceRepeat: SuggestionTradeoffChoice = {
  id: 'reduce_repeat',
  label: 'Ít lặp hơn',
  alternative: alt(['p1', 'p5'], ['p3', 'p6']),
  metrics: {
    pvna_gap: 0.8, pvna_over_by: 0.3,
    intra_team_gap: 0.2, intra_team_over_by: 0,
    repeat_over_by: 0, affected_pairs: 0, affected_players: 0,
    max_partner_pair: 1, max_opponent_pair: 1, total_cost: 0.3,
  },
  explanation: [],
}

const match: SuggestedLiveMatchRow = {
  id: 'm1',
  session_id: 's1',
  sequence_no: 1,
  round_no: 3,
  court_idx: 1,
  status: 'suggested',
  team_a: ['p1', 'p2'],
  team_b: ['p3', 'p4'],
  resting: ['p5', 'p6'],
  score_a: 0,
  score_b: 0,
  suggested_at: '2026-08-01T00:00:00Z',
  started_at: null,
  ended_at: null,
  // degraded_reason intentionally ABSENT (gap 0.85 is over tolerance but below blowout floor 1.5)
  warnings: [],
  tradeoffs: [],
  approval_required: false,
  configured_pvna_tolerance: 0.5,
  effective_pvna_tolerance: 0.5,
  tradeoff_choices: [balanced, reduceRepeat],
  recommended_tradeoff_choice: 'balanced',
  live_availability_context: { locked_player_count: 4, live_court_count: 1 },
  preview_source: 'edge',
} as unknown as SuggestedLiveMatchRow

test('Chơi luôn cost line vs actual PVNA over-tolerance', () => {
  const { getByTestId, queryByText } = render(
    <SuggestedLiveMatchCard
      match={match}
      busy={false}
      state={state}
      pvnaTolerance={0.5}
      roundPace={4}
      playersById={playersById}
      onStart={() => {}}
      onFetchAvailablePool={() => {}}
      onConfirmStartNow={() => {}}
      onCancelAvailablePool={() => {}}
      onPlayerPress={() => {}}
      onOpenSettings={() => {}}
      onOpenSwap={() => {}}
      onForcedWaitSelectionChange={() => {}}
    />,
  )
  const playCard = getByTestId('nrv2-decision-play-1')
  const texts: string[] = []
  const walk = (node: any) => {
    if (!node) return
    if (typeof node === 'string') { texts.push(node); return }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.children) node.children.forEach(walk)
  }
  walk(playCard)
  // eslint-disable-next-line no-console
  console.log('PLAY CARD TEXT >>>', JSON.stringify(texts))
  // eslint-disable-next-line no-console
  // The card offers "Chơi luôn" with a cost line. This lineup is 0.85 apart against a 0.5 tolerance —
  // over the limit, just under the 1.5 blowout floor that would have set degraded_reason. Telling the
  // host there is nothing to trade here is the one answer that is plainly false, and it is exactly the
  // imbalance the engine work upstream is trying to avoid seating.
  expect(texts.join(' | ')).not.toContain('không đánh đổi gì')
})
