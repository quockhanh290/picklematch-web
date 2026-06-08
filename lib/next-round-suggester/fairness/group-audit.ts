import type { SessionPlayerStateRow, SessionState } from '../types'

export type GroupSummary = {
  group_id: string
  label: string
  player_ids: string[]
}

export type GroupAuditRow = GroupSummary & {
  shared_matches: number
  pair_counts: Array<{ player_a: string; player_b: string; count: number }>
}

export function buildGroupSummaries(rows: SessionPlayerStateRow[]): GroupSummary[] {
  const byGroup = new Map<string, string[]>()

  for (const row of rows) {
    if (!row.group_id) continue
    const current = byGroup.get(row.group_id) ?? []
    current.push(row.player_id)
    byGroup.set(row.group_id, current)
  }

  return [...byGroup.entries()]
    .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
    .map(([groupId, playerIds], index) => ({
      group_id: groupId,
      label: `G${index + 1}`,
      player_ids: playerIds.sort(),
    }))
}

export function buildGroupAliasMap(groups: GroupSummary[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const group of groups) {
    aliases.set(group.group_id, group.label)
  }
  return aliases
}

export function buildGroupAuditRows(state: SessionState, groups: GroupSummary[]): GroupAuditRow[] {
  return groups.map(group => {
    const memberSet = new Set(group.player_ids)
    let sharedMatches = 0

    for (const round of state.rounds) {
      if (round.status !== 'completed') continue
      for (const match of round.matches) {
        const groupPlayersInMatch = [...match.team_a, ...match.team_b].filter(playerId => memberSet.has(playerId))
        if (groupPlayersInMatch.length >= 2) sharedMatches += 1
      }
    }

    const pairCounts: Array<{ player_a: string; player_b: string; count: number }> = []
    for (let i = 0; i < group.player_ids.length; i += 1) {
      for (let j = i + 1; j < group.player_ids.length; j += 1) {
        const playerA = group.player_ids[i]
        const playerB = group.player_ids[j]
        const count = state.players.get(playerA)?.partner_counts.get(playerB) ?? 0
        pairCounts.push({ player_a: playerA, player_b: playerB, count })
      }
    }

    return {
      ...group,
      shared_matches: sharedMatches,
      pair_counts: pairCounts.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return `${a.player_a}:${a.player_b}`.localeCompare(`${b.player_a}:${b.player_b}`)
      }),
    }
  })
}
