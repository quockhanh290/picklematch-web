// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlannedBoardMatch } from './pair-swap-search.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { PlayerSessionState } from '../types.ts'

export type PlannedMatchViolation = {
  matchIndex: number
  playerId?: string
  reason: 'invalid_team_size' | 'duplicate_player' | 'missing_player' | 'checked_out' | 'opted_rest' | 'busy' | 'reserved'
}

export function validatePlannedBoard(options: {
  matches: PlannedBoardMatch[]
  players: ReadonlyMap<string, PlayerSessionState>
  busyIds?: ReadonlySet<string>
  reservedIds?: ReadonlySet<string>
}) {
  const busyIds = options.busyIds ?? new Set<string>()
  const reservedIds = options.reservedIds ?? new Set<string>()
  const seen = new Set<string>()
  const violations: PlannedMatchViolation[] = []

  options.matches.forEach((match, matchIndex) => {
    if (match.team_a.length !== 2 || match.team_b.length !== 2) {
      violations.push({ matchIndex, reason: 'invalid_team_size' })
    }
    for (const playerId of [...match.team_a, ...match.team_b]) {
      if (seen.has(playerId)) {
        violations.push({ matchIndex, playerId, reason: 'duplicate_player' })
      }
      seen.add(playerId)
      const player = options.players.get(playerId)
      if (!player) violations.push({ matchIndex, playerId, reason: 'missing_player' })
      else if (player.checked_out_at !== null) violations.push({ matchIndex, playerId, reason: 'checked_out' })
      else if (player.opted_rest) violations.push({ matchIndex, playerId, reason: 'opted_rest' })
      if (busyIds.has(playerId)) violations.push({ matchIndex, playerId, reason: 'busy' })
      if (reservedIds.has(playerId)) violations.push({ matchIndex, playerId, reason: 'reserved' })
    }
  })

  const invalidMatchIndexes = [...new Set(violations.map(violation => violation.matchIndex))]
    .sort((left, right) => left - right)
  return {
    valid: violations.length === 0,
    violations,
    invalidMatchIndexes,
  }
}

function isUnavailable(
  playerId: string,
  players: ReadonlyMap<string, PlayerSessionState>,
  busyIds: ReadonlySet<string>,
  reservedIds: ReadonlySet<string>,
) {
  const player = players.get(playerId)
  return !player
    || player.checked_out_at !== null
    || player.opted_rest
    || busyIds.has(playerId)
    || reservedIds.has(playerId)
}

export function repairUnavailablePlannedBoard(options: {
  matches: PlannedBoardMatch[]
  players: ReadonlyMap<string, PlayerSessionState>
  busyIds?: ReadonlySet<string>
  reservedIds?: ReadonlySet<string>
}) {
  const busyIds = options.busyIds ?? new Set<string>()
  const reservedIds = options.reservedIds ?? new Set<string>()
  const board = options.matches.map(match => ({
    team_a: [...match.team_a] as [string, string],
    team_b: [...match.team_b] as [string, string],
  }))
  const used = new Set<string>()
  const slots: Array<{ matchIndex: number; team: 'team_a' | 'team_b'; playerIndex: number; replacedId: string }> = []
  const teams = ['team_a', 'team_b'] as const

  board.forEach((match, matchIndex) => {
    teams.forEach(team => {
      match[team].forEach((playerId, playerIndex) => {
        if (used.has(playerId) || isUnavailable(playerId, options.players, busyIds, reservedIds)) {
          slots.push({ matchIndex, team, playerIndex, replacedId: playerId })
        } else {
          used.add(playerId)
        }
      })
    })
  })

  const eligible = [...options.players.values()]
    .filter(player => !used.has(player.player_id))
    .filter(player => !isUnavailable(player.player_id, options.players, busyIds, reservedIds))
  const replacements: Array<{ matchIndex: number; replacedId: string; replacementId: string }> = []

  for (const slot of slots) {
    const replaced = options.players.get(slot.replacedId)
    eligible.sort((left, right) => {
      if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
      if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
      const replacedPvna = Number(replaced?.effective_pvna ?? replaced?.pvna ?? 0)
      const leftDelta = Math.abs(Number(left.effective_pvna ?? left.pvna) - replacedPvna)
      const rightDelta = Math.abs(Number(right.effective_pvna ?? right.pvna) - replacedPvna)
      return leftDelta - rightDelta || left.player_id.localeCompare(right.player_id)
    })
    const replacement = eligible.shift()
    if (!replacement) break
    board[slot.matchIndex][slot.team][slot.playerIndex] = replacement.player_id
    used.add(replacement.player_id)
    replacements.push({
      matchIndex: slot.matchIndex,
      replacedId: slot.replacedId,
      replacementId: replacement.player_id,
    })
  }

  return {
    board,
    replacements,
    changedMatchIndexes: [...new Set(replacements.map(replacement => replacement.matchIndex))]
      .sort((left, right) => left - right),
    validation: validatePlannedBoard({
      matches: board,
      players: options.players,
      busyIds,
      reservedIds,
    }),
  }
}
