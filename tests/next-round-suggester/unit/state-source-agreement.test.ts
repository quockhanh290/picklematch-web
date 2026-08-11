import {
  buildProjectedStateAfterCompletedLiveRound,
  buildProjectedStateAfterLiveMatch,
} from '../../../lib/next-round-suggester/live-preview'
import { comparePlayersByPriority } from '../../../lib/next-round-suggester/select'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state'
import { Tier } from '../../../lib/next-round-suggester/classify'
import { createPlayer, createState } from '../helpers/factories'
import type {
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPlayerStateRow,
  SessionState,
} from '../../../lib/next-round-suggester/types'

describe('SessionState source agreement', () => {
  it('orders a live-match projection the same way as reloading the equivalent rows from the database', () => {
    const justPlayed = createPlayer('a-just-played', {
      pvna: 3,
      matches_played: 1,
      last_played_round: 0,
      last_played_seq: 10,
    } as never)
    const waiting = createPlayer('b-waiting', {
      pvna: 3,
      matches_played: 2,
      last_played_round: 0,
      last_played_seq: 11,
    } as never)
    const fillers = ['f1', 'f2', 'f3'].map((id) => createPlayer(id, { pvna: 3 }))
    const state = createState({ players: [justPlayed, waiting, ...fillers], currentRound: 1 })

    const match = {
      id: 'live-1',
      session_id: state.session_id,
      sequence_no: 20,
      round_no: 3,
      court_idx: 0,
      status: 'completed',
      team_a: ['a-just-played', 'f1'],
      team_b: ['f2', 'f3'],
      resting: [],
      score_a: 11,
      score_b: 9,
      suggested_at: '2026-05-14T12:00:00.000Z',
      started_at: null,
      ended_at: '2026-05-14T12:15:00.000Z',
    } as SessionLiveMatchRow

    const projected = buildProjectedStateAfterLiveMatch(state, match, 3)
    const fromDb = loadStateFromRows(state, [
      rowFromPlayer(projected.players.get('a-just-played')!),
      rowFromPlayer(projected.players.get('b-waiting')!),
    ])

    expect(priorityOrder(projected, ['a-just-played', 'b-waiting'])).toEqual(
      priorityOrder(fromDb, ['a-just-played', 'b-waiting']),
    )
    expect(priorityOrder(projected, ['a-just-played', 'b-waiting'])).toEqual(['b-waiting', 'a-just-played'])
  })

  it('orders a completed-round rest projection the same way as reloading the equivalent rows from the database', () => {
    const earlierRestRun = createPlayer('z-earlier-rest-run', {
      pvna: 3,
      matches_played: 9,
      last_played_round: 1,
      consecutive_rest: 0,
      last_rest_started_round: undefined,
    } as never)
    const laterRestRun = createPlayer('a-later-rest-run', {
      pvna: 3,
      matches_played: 1,
      last_played_round: 4,
      consecutive_rest: 0,
      last_rest_started_round: undefined,
    } as never)
    const state = createState({ players: [earlierRestRun, laterRestRun], currentRound: 5 })

    const projected = buildProjectedStateAfterCompletedLiveRound(state, new Set<string>())
    const fromDb = loadStateFromRows(state, [
      rowFromPlayer(projected.players.get('z-earlier-rest-run')!),
      rowFromPlayer(projected.players.get('a-later-rest-run')!),
    ])

    expect(priorityOrder(projected, ['z-earlier-rest-run', 'a-later-rest-run'])).toEqual(
      priorityOrder(fromDb, ['z-earlier-rest-run', 'a-later-rest-run']),
    )
    expect(priorityOrder(projected, ['z-earlier-rest-run', 'a-later-rest-run'])).toEqual([
      'z-earlier-rest-run',
      'a-later-rest-run',
    ])
  })
})

function priorityOrder(state: SessionState, ids: string[]) {
  const players = ids.map((id) => state.players.get(id)!)
  const tiers = new Map(ids.map((id) => [id, Tier.FLEXIBLE]))

  return [...players]
    .sort((a, b) => comparePlayersByPriority(a, b, tiers))
    .map((player) => player.player_id)
}

function loadStateFromRows(base: SessionState, playerRows: SessionPlayerStateRow[]): SessionState {
  return mapRowsToSessionState({
    sessionId: base.session_id,
    playerRows,
    pairRows: [],
    roundRows: [],
    courts: base.config.courts,
    pvnaTolerance: base.config.pvna_tolerance,
  })
}

function rowFromPlayer(player: PlayerSessionState): SessionPlayerStateRow {
  return {
    session_id: 'session-test',
    player_id: player.player_id,
    group_id: player.group_id,
    checked_in_at: player.checked_in_at.toISOString(),
    checked_out_at: player.checked_out_at?.toISOString() ?? null,
    matches_played: player.matches_played,
    last_played_round: player.last_played_round,
    consecutive_rest: player.consecutive_rest,
    consecutive_play: player.consecutive_play,
    last_played_seq: player.last_played_seq,
    opted_rest: player.opted_rest,
    effective_pvna: player.effective_pvna,
    players: {
      pvna: player.pvna,
      gender: player.gender,
      partner_gender_pref: player.partner_gender_pref,
      opponent_gender_pref: player.opponent_gender_pref,
    },
  }
}
