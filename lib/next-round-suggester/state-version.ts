import type { SessionState } from './types'

export type SessionStateFingerprint = {
  current_round: number
  players: string[]
  rounds: string[]
}

function dateKey(value: Date | null): string {
  return value ? value.toISOString() : ''
}

function mapKey(map: Map<string, number>): string {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(',')
}

export function buildSessionStateFingerprint(state: SessionState): SessionStateFingerprint {
  const players = [...state.players.values()]
    .sort((left, right) => left.player_id.localeCompare(right.player_id))
    .map(player => [
      player.player_id,
      player.group_id ?? '',
      dateKey(player.checked_in_at),
      dateKey(player.checked_out_at),
      player.matches_played,
      player.last_played_round,
      player.consecutive_play,
      player.consecutive_rest,
      player.opted_rest ? 1 : 0,
      mapKey(player.partner_counts),
      mapKey(player.opponent_counts),
    ].join('|'))

  const rounds = [...state.rounds]
    .sort((left, right) => left.round_no - right.round_no)
    .map(round => [
      round.round_no,
      round.status,
      dateKey(round.started_at),
      dateKey(round.ended_at),
    ].join('|'))

  return {
    current_round: state.current_round,
    players,
    rounds,
  }
}

export function sessionStateFingerprintEquals(left: unknown, right: SessionStateFingerprint): boolean {
  if (!left || typeof left !== 'object') return false
  const candidate = left as Partial<SessionStateFingerprint>
  return candidate.current_round === right.current_round
    && Array.isArray(candidate.players)
    && Array.isArray(candidate.rounds)
    && candidate.players.length === right.players.length
    && candidate.rounds.length === right.rounds.length
    && candidate.players.every((value, index) => value === right.players[index])
    && candidate.rounds.every((value, index) => value === right.rounds[index])
}
