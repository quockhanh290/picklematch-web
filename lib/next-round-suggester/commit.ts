// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { normalizePairKey } from './state'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionState,
} from './types'

export type CommitResult = {
  players: Map<string, PlayerSessionState>
  pairHistory: SessionPairHistoryRow[]
}

export function pairHistoryRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()

  function mergeCount(playerA: string, playerB: string, field: 'partner_count' | 'opponent_count', count: number) {
    const [a, b] = normalizePairKey(playerA, playerB)
    const key = `${a}:${b}`
    const existing = rows.get(key) ?? {
      session_id: state.session_id,
      player_a: a,
      player_b: b,
      partner_count: 0,
      opponent_count: 0,
    }
    existing[field] = Math.max(existing[field], count)
    rows.set(key, existing)
  }

  for (const player of state.players.values()) {
    for (const [partnerId, count] of player.partner_counts) {
      mergeCount(player.player_id, partnerId, 'partner_count', count)
    }
    for (const [opponentId, count] of player.opponent_counts) {
      mergeCount(player.player_id, opponentId, 'opponent_count', count)
    }
  }

  return [...rows.values()].sort((left, right) =>
    `${left.player_a}:${left.player_b}`.localeCompare(`${right.player_a}:${right.player_b}`),
  )
}

function clonePlayer(player: PlayerSessionState): PlayerSessionState {
  return {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }
}

function getPlayedIds(matches: Match[]): Set<string> {
  return new Set(matches.flatMap((match) => [...match.team_a, ...match.team_b]))
}

function incrementPair(
  pairRows: Map<string, SessionPairHistoryRow>,
  sessionId: string,
  playerA: string,
  playerB: string,
  field: 'partner_count' | 'opponent_count',
) {
  const [a, b] = normalizePairKey(playerA, playerB)
  const key = `${a}:${b}`
  const row =
    pairRows.get(key) ??
    {
      session_id: sessionId,
      player_a: a,
      player_b: b,
      partner_count: 0,
      opponent_count: 0,
    }

  row[field] += 1
  pairRows.set(key, row)
}

export function buildPairHistoryUpdates(
  sessionId: string,
  matches: Match[],
  existingRows: SessionPairHistoryRow[] = [],
): SessionPairHistoryRow[] {
  const pairRows = new Map(
    existingRows.map((row) => [`${row.player_a}:${row.player_b}`, { ...row }]),
  )

  for (const match of matches) {
    incrementPair(pairRows, sessionId, match.team_a[0], match.team_a[1], 'partner_count')
    incrementPair(pairRows, sessionId, match.team_b[0], match.team_b[1], 'partner_count')

    for (const playerA of match.team_a) {
      for (const playerB of match.team_b) {
        incrementPair(pairRows, sessionId, playerA, playerB, 'opponent_count')
      }
    }
  }

  return [...pairRows.values()].sort((a, b) => {
    const keyA = `${a.player_a}:${a.player_b}`
    const keyB = `${b.player_a}:${b.player_b}`
    return keyA.localeCompare(keyB)
  })
}

export function commitCompletedRound(
  state: SessionState,
  round: Pick<RoundRecord, 'round_no' | 'matches'> & Partial<Pick<RoundRecord, 'resting'>>,
  existingPairRows: SessionPairHistoryRow[] = [],
): CommitResult {
  const playedIds = getPlayedIds(round.matches)
  const rosterIds = new Set([...playedIds, ...(round.resting ?? [])])
  const players = new Map<string, PlayerSessionState>()

  for (const [playerId, player] of state.players) {
    const next = clonePlayer(player)

    if (playedIds.has(playerId)) {
      // Count as played regardless of checkout status — player may have left mid-round.
      next.matches_played += 1
      next.last_played_round = round.round_no
      next.consecutive_play += 1
      next.consecutive_rest = 0
      next.opted_rest = false
    } else if (next.checked_out_at === null && rosterIds.has(playerId)) {
      next.consecutive_rest += 1
      next.consecutive_play = 0
      next.opted_rest = false
    }

    players.set(playerId, next)
  }

  const pairHistory = buildPairHistoryUpdates(state.session_id, round.matches, existingPairRows)

  return {
    players,
    pairHistory,
  }
}
