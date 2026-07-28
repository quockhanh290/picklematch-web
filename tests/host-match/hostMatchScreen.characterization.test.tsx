import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'

import { getLevelIdForElo } from '@/lib/eloSystem'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { HostMatchScreen } from '@/features/host/session-detail/HostMatchScreen'

const mockInsert = jest.fn(async () => ({ data: null, error: null }))
const mockFrom = jest.fn((table: string) => ({ insert: (row: unknown) => mockInsert(table, row) }))

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}))

function buildPlayer(id: string, name: string, pvna: number): ArrangementPlayer {
  const elo = Math.round(pvna * 400)
  return {
    id,
    name,
    elo,
    team: 0,
    reliability: 90,
    levelId: getLevelIdForElo(elo),
    skillTag: 'PVNA',
    gender: 'male',
    pvna,
    status: 'confirmed',
    checkInStatus: 'present',
    metadata: null,
  }
}

const FOUR_PLAYERS: ArrangementPlayer[] = [
  buildPlayer('p1', 'An Nguyen', 3.2),
  buildPlayer('p2', 'Binh Tran', 3.4),
  buildPlayer('p3', 'Chi Le', 3.0),
  buildPlayer('p4', 'Dung Pham', 3.1),
]

// Pins the round-robin "generate a round -> confirm it" flow: this is the one
// business-critical path that has to still insert exactly one session_matches
// row, with the same shape, after F2 moves state/handlers/supabase I/O out of
// the screen into useHostMatchController + host-match/api.ts.
describe('HostMatchScreen — round-robin generate then confirm (characterization)', () => {
  beforeEach(() => {
    mockInsert.mockClear()
    mockFrom.mockClear()
  })

  it('inserts exactly one playing session_matches row for the generated pairing', async () => {
    const { getByText } = render(
      <HostMatchScreen
        sessionId="session-abc"
        matches={[]}
        players={FOUR_PLAYERS}
        onUpdated={jest.fn()}
        courtCount={1}
        formatType="round_robin"
      />
    )

    fireEvent.press(getByText('TẠO LƯỢT ROUND ROBIN'))

    const startButton = await waitFor(() => getByText('BẮT ĐẦU'))
    fireEvent.press(startButton)

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })

    expect(mockFrom).toHaveBeenCalledWith('session_matches')

    const [, payload] = mockInsert.mock.calls[0] as [string, any]
    expect(payload.session_id).toBe('session-abc')
    expect(payload.status).toBe('playing')
    expect(payload.team_a_no).toBe(0)
    expect(payload.team_b_no).toBe(0)
    expect(payload.players_snapshot.team_a).toHaveLength(2)
    expect(payload.players_snapshot.team_b).toHaveLength(2)

    const allIds = new Set([...payload.players_snapshot.team_a, ...payload.players_snapshot.team_b])
    expect(allIds).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
  })
})
