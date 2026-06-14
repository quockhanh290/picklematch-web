import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state'
import type {
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionRoundRow,
} from '../../../lib/next-round-suggester/types'

function playerRow(
  playerId: string,
  players: SessionPlayerStateRow['players'],
  metadata: Record<string, unknown> | null = null,
): SessionPlayerStateRow {
  return {
    session_id: 'session-test',
    player_id: playerId,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00.000Z').toISOString(),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    players,
    session_players: { metadata },
  }
}

function mapState(
  playerRows: SessionPlayerStateRow[],
  preferenceRows: SessionPlayerPreferenceRow[] = [],
) {
  return mapRowsToSessionState({
    sessionId: 'session-test',
    playerRows,
    pairRows: [] as SessionPairHistoryRow[],
    roundRows: [] as SessionRoundRow[],
    preferenceRows,
  })
}

describe('mapRowsToSessionState PVNA fallback', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('uses newbie PVNA and warns when every rating source is missing', () => {
    const state = mapState([playerRow('p1', { pvna: null, current_elo: null, elo: null })])

    expect(state.players.get('p1')?.pvna).toBe(2.1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      fallbackPvna: 2.1,
      count: 1,
      players: [expect.objectContaining({ player_id: 'p1' })],
    }))
  })

  it('uses current_elo without warning when pvna is missing', () => {
    const state = mapState([playerRow('p1', { pvna: null, current_elo: 1000, elo: null })])

    expect(state.players.get('p1')?.pvna).toBe(2.6)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('treats zero PVNA as invalid and falls back to newbie', () => {
    const state = mapState([playerRow('p1', { pvna: 0, current_elo: null, elo: null })])

    expect(state.players.get('p1')?.pvna).toBe(2.1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('logs source context when session_players profile hides a valid state profile', () => {
    const state = mapState(
      [playerRow('p1', { pvna: 3.5, current_elo: null, elo: null })],
      [{ player_id: 'p1', metadata: null, players: { pvna: null, current_elo: null, elo: null } }],
    )

    expect(state.players.get('p1')?.pvna).toBe(2.1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      players: [expect.objectContaining({
        player_id: 'p1',
        selected_profile_source: 'session_players',
        state_profile_has_rating: true,
        state_profile: expect.objectContaining({ pvna: 3.5 }),
        preference_profile: expect.objectContaining({ pvna: null }),
      })],
    }))
  })

  it('uses metadata gender preference override and logs when it differs from profile', () => {
    const state = mapState([
      playerRow(
        'p1',
        { pvna: 3.2, current_elo: null, elo: null, partner_gender_pref: 'M' },
        { partner_gender_pref: 'F' },
      ),
    ])

    expect(state.players.get('p1')?.partner_gender_pref).toBe('F')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toBe('[next-round-suggester] session metadata gender preference overrides profile preference')
    expect(warnSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      sessionId: 'session-test',
      count: 1,
      overrides: [expect.objectContaining({
        player_id: 'p1',
        key: 'partner_gender_pref',
        source: 'session_player_state_metadata',
        metadata_value: 'F',
        profile_value: 'M',
        normalized_metadata_value: 'F',
        normalized_profile_value: 'M',
      })],
    }))
  })

  it('does not log metadata preference override when metadata matches profile', () => {
    const state = mapState([
      playerRow(
        'p1',
        { pvna: 3.2, current_elo: null, elo: null, opponent_gender_pref: 'F' },
        { opponent_gender_pref: 'F' },
      ),
    ])

    expect(state.players.get('p1')?.opponent_gender_pref).toBe('F')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('uses profile gender preference without warning when metadata is missing', () => {
    const state = mapState([
      playerRow('p1', { pvna: 3.2, current_elo: null, elo: null, partner_gender_pref: 'M' }),
    ])

    expect(state.players.get('p1')?.partner_gender_pref).toBe('M')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('preserves session_player_state metadata precedence over preference row metadata', () => {
    const state = mapState(
      [
        playerRow(
          'p1',
          { pvna: 3.2, current_elo: null, elo: null, partner_gender_pref: 'M' },
          { partner_gender_pref: 'F' },
        ),
      ],
      [
        {
          player_id: 'p1',
          metadata: { partner_gender_pref: 'M' },
          players: { pvna: 3.2, current_elo: null, elo: null, partner_gender_pref: 'M' },
        },
      ],
    )

    expect(state.players.get('p1')?.partner_gender_pref).toBe('F')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      overrides: [expect.objectContaining({
        player_id: 'p1',
        source: 'session_player_state_metadata',
        metadata_value: 'F',
        profile_value: 'M',
      })],
    }))
  })
})
