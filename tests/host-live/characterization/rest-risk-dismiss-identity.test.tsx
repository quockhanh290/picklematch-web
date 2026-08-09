jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
}))

jest.mock('@/lib/supabase', () => ({ supabase: {}, __esModule: true }))

import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'

import { RestRiskBanner } from '@/features/host/session-detail/next-round-v2/components/ScreenComponents'
import type { PlayerSessionState, SessionState } from '@/lib/next-round-suggester/types'

function player(id: string, consecutiveRest: number): PlayerSessionState {
  return {
    player_id: id,
    pvna: 3,
    group_id: null,
    checked_in_at: new Date(),
    checked_out_at: null,
    matches_played: 2,
    last_played_round: 1,
    consecutive_rest: consecutiveRest,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: 'male',
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
    rounds_available: 10,
  } as PlayerSessionState
}

function state(players: PlayerSessionState[]): SessionState {
  return {
    session_id: 'rest-risk-identity-session',
    current_round: 3,
    status: 'playing',
    config: { courts: 1, pvna_tolerance: 0.75, weights: {} as any },
    players: new Map(players.map(p => [p.player_id, p])),
    rounds: [],
  } as unknown as SessionState
}

const playersById = new Map<string, any>([
  ['an', { player_id: 'an', display_name: 'An' }],
  ['binh', { player_id: 'binh', display_name: 'Binh' }],
  ['c1', { player_id: 'c1', display_name: 'C1' }],
  ['c2', { player_id: 'c2', display_name: 'C2' }],
  ['c3', { player_id: 'c3', display_name: 'C3' }],
  ['c4', { player_id: 'c4', display_name: 'C4' }],
])

describe('RestRiskBanner dismissal identity', () => {
  it('shows the banner again when the at-risk player set changes but its size does not', () => {
    const view = render(
      <RestRiskBanner
        state={state([
          player('an', 1),
          player('binh', 0),
          player('c1', 0),
          player('c2', 0),
          player('c3', 0),
          player('c4', 0),
        ])}
        activeMatches={[]}
        suggestedMatches={[{ id: 'round-n', court_idx: 0, team_a: ['c1', 'c2'], team_b: ['c3', 'c4'], warnings: [] } as any]}
        playersById={playersById}
        courtCount={1}
        onSetCourtCount={() => {}}
        onOpenSwapForPlayer={() => {}}
      />,
    )

    expect(view.queryByTestId('nrv2-rest-risk-banner')).toBeTruthy()
    fireEvent.press(view.getByTestId('nrv2-rest-risk-dismiss'))
    expect(view.queryByTestId('nrv2-rest-risk-banner')).toBeNull()

    view.rerender(
      <RestRiskBanner
        state={state([
          player('an', 0),
          player('binh', 1),
          player('c1', 0),
          player('c2', 0),
          player('c3', 0),
          player('c4', 0),
        ])}
        activeMatches={[]}
        suggestedMatches={[{ id: 'round-n-plus-1', court_idx: 0, team_a: ['an', 'c2'], team_b: ['c3', 'c4'], warnings: [] } as any]}
        playersById={playersById}
        courtCount={1}
        onSetCourtCount={() => {}}
        onOpenSwapForPlayer={() => {}}
      />,
    )

    expect(view.queryByTestId('nrv2-rest-risk-banner')).toBeTruthy()
  })
})
