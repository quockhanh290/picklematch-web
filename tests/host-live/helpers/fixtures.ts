import { getLevelIdForElo } from '@/lib/eloSystem'
import type {
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { LiveRows, RegisteredSessionPlayerRow } from '@/features/host/session-detail/next-round-v2/types'

export const FIXTURE_SESSION_ID = 'test-session-fixture'
export const FIXTURE_CHECKED_IN_AT = '2026-07-27T00:00:00.000Z'

type PlayerSeed = {
  id: string
  name: string
  pvna: number
  gender: 'male' | 'female'
}

// Seeded, not random — 2 balanced pairs so the suggester has a trivial full board to build.
const PLAYER_SEEDS: PlayerSeed[] = [
  { id: 'fixture-player-1', name: 'An Nguyen', pvna: 3.2, gender: 'male' },
  { id: 'fixture-player-2', name: 'Binh Tran', pvna: 3.4, gender: 'male' },
  { id: 'fixture-player-3', name: 'Chi Le', pvna: 3.0, gender: 'female' },
  { id: 'fixture-player-4', name: 'Dung Pham', pvna: 3.1, gender: 'female' },
]

function eloFor(pvna: number) {
  return Math.round(pvna * 400)
}

function buildArrangementPlayer(seed: PlayerSeed): ArrangementPlayer {
  const elo = eloFor(seed.pvna)
  return {
    id: seed.id,
    name: seed.name,
    elo,
    team: 0,
    reliability: 90,
    levelId: getLevelIdForElo(elo),
    skillTag: 'PVNA',
    gender: seed.gender,
    pvna: seed.pvna,
    status: 'confirmed',
    checkInStatus: 'present',
    metadata: null,
  }
}

function buildPlayerStateRow(sessionId: string, seed: PlayerSeed): SessionPlayerStateRow {
  const elo = eloFor(seed.pvna)
  return {
    session_id: sessionId,
    player_id: seed.id,
    group_id: null,
    checked_in_at: FIXTURE_CHECKED_IN_AT,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: 0,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
    players: {
      name: seed.name,
      pvna: seed.pvna,
      current_elo: elo,
      elo,
      gender: seed.gender,
      partner_gender_pref: null,
      opponent_gender_pref: null,
    },
    session_players: {
      metadata: null,
    },
  }
}

function buildRegisteredPlayerRow(seed: PlayerSeed): RegisteredSessionPlayerRow {
  const elo = eloFor(seed.pvna)
  return {
    player_id: seed.id,
    team_no: 0,
    status: 'confirmed',
    check_in_status: 'present',
    metadata: null,
    players: {
      name: seed.name,
      pvna: seed.pvna,
      current_elo: elo,
      elo,
      gender: seed.gender,
      reliability_score: 90,
      sessions_joined: 5,
      no_show_count: 0,
      self_assessed_level: null,
      skill_label: null,
      partner_gender_pref: null,
      opponent_gender_pref: null,
    },
  }
}

export type SessionFixtureOverrides = {
  sessionId?: string
  players?: ArrangementPlayer[]
  liveRows?: Partial<LiveRows>
}

export type SessionFixture = {
  sessionId: string
  players: ArrangementPlayer[]
  liveRows: LiveRows
  // Raw shape of the get_live_session_snapshot_versioned RPC response
  // (see features/host/session-detail/next-round-v2/queries.ts:useLiveSessionQuery).
  snapshot: {
    live_state_version: number | null
    player_rows: SessionPlayerStateRow[]
    registered_player_rows: RegisteredSessionPlayerRow[]
    pair_rows: SessionPairHistoryRow[]
    round_rows: SessionRoundRow[]
    live_match_rows: SessionLiveMatchRow[]
  }
  // Shape returned by the session-live-matches-suggest edge function, as consumed
  // via fetchLiveMatchesPreview (features/host/session-detail/next-round-v2/api.ts).
  previewResponse: {
    ok: true
    live_state_version: number | null
    payloads: unknown[]
  }
}

export function makeSessionFixture(overrides: SessionFixtureOverrides = {}): SessionFixture {
  const sessionId = overrides.sessionId ?? FIXTURE_SESSION_ID
  const players = overrides.players ?? PLAYER_SEEDS.map(buildArrangementPlayer)

  const liveRows: LiveRows = {
    playerRows: PLAYER_SEEDS.map(seed => buildPlayerStateRow(sessionId, seed)),
    registeredPlayerRows: PLAYER_SEEDS.map(buildRegisteredPlayerRow),
    pairRows: [],
    roundRows: [],
    liveMatchRows: [],
    liveStateVersion: 1,
    ...overrides.liveRows,
  }

  const snapshot = {
    live_state_version: liveRows.liveStateVersion,
    player_rows: liveRows.playerRows,
    registered_player_rows: liveRows.registeredPlayerRows,
    pair_rows: liveRows.pairRows,
    round_rows: liveRows.roundRows,
    live_match_rows: liveRows.liveMatchRows,
  }

  const previewResponse = {
    ok: true as const,
    live_state_version: liveRows.liveStateVersion,
    payloads: [] as unknown[],
  }

  return { sessionId, players, liveRows, snapshot, previewResponse }
}
