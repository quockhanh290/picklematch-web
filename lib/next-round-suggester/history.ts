// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { commitCompletedRound } from './commit.ts'
import type {
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
  SuggestionAlternative,
} from './types'

export function previewStateAfterAlternative(
  state: SessionState,
  alternative: SuggestionAlternative,
): SessionState {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: state.current_round,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: null,
    ended_at: null,
  }

  return applyCompletedRoundToState(state, round)
}

export function rebuildStateThroughRound(
  state: SessionState,
  maxRoundNo: number,
): SessionState {
  const basePlayers = new Map<string, PlayerSessionState>(
    [...state.players].map(([playerId, player]) => [
      playerId,
      {
        ...player,
        checked_out_at: null,
        matches_played: 0,
        last_played_round: -1,
        consecutive_rest: 0,
        consecutive_play: 0,
        partner_counts: new Map(),
        opponent_counts: new Map(),
      },
    ]),
  )
  let rebuilt: SessionState = {
    ...state,
    current_round: 0,
    players: basePlayers,
    rounds: [],
  }

  for (const round of state.rounds
    .filter((item) => item.status === 'completed' && item.round_no <= maxRoundNo)
    .sort((a, b) => a.round_no - b.round_no)) {
    rebuilt = applyCompletedRoundToState(rebuilt, round)
  }

  return rebuilt
}

export function applyCompletedRoundToState(
  state: SessionState,
  round: Pick<RoundRecord, 'session_id' | 'round_no' | 'status' | 'matches' | 'resting' | 'started_at' | 'ended_at'>,
): SessionState {
  const committed = commitCompletedRound(state, round, pairRowsFromState(state))

  return {
    ...state,
    current_round: round.round_no + 1,
    players: applyPairHistoryToPlayers(committed.players, committed.pairHistory),
    rounds: [...state.rounds, round as RoundRecord],
  }
}

export function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()

  for (const player of state.players.values()) {
    for (const [partnerId, partnerCount] of player.partner_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, partnerId, { partner_count: partnerCount })
    }

    for (const [opponentId, opponentCount] of player.opponent_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, opponentId, { opponent_count: opponentCount })
    }
  }

  return [...rows.values()]
}

export function applyPairHistoryToPlayers(
  players: Map<string, PlayerSessionState>,
  rows: SessionPairHistoryRow[],
): Map<string, PlayerSessionState> {
  for (const player of players.values()) {
    player.partner_counts = new Map()
    player.opponent_counts = new Map()
  }

  for (const row of rows) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)
    if (!playerA || !playerB) continue

    playerA.partner_counts.set(row.player_b, row.partner_count)
    playerB.partner_counts.set(row.player_a, row.partner_count)
    playerA.opponent_counts.set(row.player_b, row.opponent_count)
    playerB.opponent_counts.set(row.player_a, row.opponent_count)
  }

  return players
}

function upsertPairRow(
  rows: Map<string, SessionPairHistoryRow>,
  sessionId: string,
  playerA: string,
  playerB: string,
  patch: Partial<Pick<SessionPairHistoryRow, 'partner_count' | 'opponent_count'>>,
) {
  const [a, b] = playerA < playerB ? [playerA, playerB] : [playerB, playerA]
  const key = `${a}:${b}`
  const existing = rows.get(key) ?? {
    session_id: sessionId,
    player_a: a,
    player_b: b,
    partner_count: 0,
    opponent_count: 0,
  }

  rows.set(key, {
    ...existing,
    partner_count: Math.max(existing.partner_count, patch.partner_count ?? 0),
    opponent_count: Math.max(existing.opponent_count, patch.opponent_count ?? 0),
  })
}
