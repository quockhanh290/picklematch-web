// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { RollingPlanCheckpoint, RollingPlanPlayerTarget, RollingPlanTarget } from './rolling-horizon.ts'

type SerializedPlayer = {
  player_id?: unknown
  pvna?: unknown
  effective_pvna?: unknown
  matches_played?: unknown
  rounds_available?: unknown
  consecutive_rest?: unknown
  consecutive_play?: unknown
  partner_counts?: unknown
  opponent_counts?: unknown
}

type PlannedMatch = {
  team_a?: unknown
  team_b?: unknown
}

export type RollingTargetPlanRound = {
  round_no: number
  matches: unknown[]
  resting: string[]
}

type PlayerAccumulator = RollingPlanPlayerTarget & {
  partner_counts: Map<string, number>
  opponent_counts: Map<string, number>
  consecutive_rest: number
  consecutive_play: number
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function ids(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  if (typeof value[0] !== 'string' || typeof value[1] !== 'string') return null
  return [value[0], value[1]]
}

function serializedCounts(value: unknown) {
  if (!Array.isArray(value)) return new Map<string, number>()
  return new Map(value.flatMap(entry => (
    Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(Number(entry[1]))
      ? [[entry[0], Number(entry[1])] as [string, number]]
      : []
  )))
}

function repeatExposure(counts: ReadonlyMap<string, number>) {
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function updatePair(
  players: Map<string, PlayerAccumulator>,
  leftId: string,
  rightId: string,
  kind: 'partner' | 'opponent',
) {
  for (const [playerId, otherId] of [[leftId, rightId], [rightId, leftId]]) {
    const player = players.get(playerId)
    if (!player) continue
    const counts = kind === 'partner' ? player.partner_counts : player.opponent_counts
    counts.set(otherId, (counts.get(otherId) ?? 0) + 1)
  }
}

function playerTarget(player: PlayerAccumulator): RollingPlanPlayerTarget {
  return {
    matches: player.matches,
    rests: player.rests,
    quality_debt: player.quality_debt,
    partner_diversity: player.partner_counts.size,
    opponent_diversity: player.opponent_counts.size,
    partner_repeat_exposure: repeatExposure(player.partner_counts),
    opponent_repeat_exposure: repeatExposure(player.opponent_counts),
    max_consecutive_rest: player.max_consecutive_rest,
    max_consecutive_play: player.max_consecutive_play,
  }
}

function checkpoint(
  ratio: number,
  completedRounds: number,
  players: ReadonlyMap<string, PlayerAccumulator>,
): RollingPlanCheckpoint {
  const targets = Object.fromEntries([...players].map(([id, player]) => [id, playerTarget(player)]))
  return {
    progress_ratio: ratio,
    completed_plan_rounds: completedRounds,
    target_total_appearances: Object.values(targets).reduce((sum, target) => sum + target.matches, 0),
    players: targets,
  }
}

export function buildRollingPlanTarget(options: {
  planVersionId: string
  baselinePlayers: SerializedPlayer[]
  baselineRounds?: Array<{ matches?: unknown }>
  plannedRounds: RollingTargetPlanRound[]
  pvnaByPlayer?: ReadonlyMap<string, number>
  pvnaTolerance: number
}): RollingPlanTarget | null {
  const players = new Map<string, PlayerAccumulator>()
  const baselineById = new Map<string, SerializedPlayer>()
  for (const raw of options.baselinePlayers) {
    if (typeof raw.player_id !== 'string') continue
    baselineById.set(raw.player_id, raw)
    const partnerCounts = serializedCounts(raw.partner_counts)
    const opponentCounts = serializedCounts(raw.opponent_counts)
    const consecutiveRest = Math.max(0, finite(raw.consecutive_rest))
    const consecutivePlay = Math.max(0, finite(raw.consecutive_play))
    players.set(raw.player_id, {
      matches: Math.max(0, finite(raw.matches_played)),
      rests: Math.max(0, finite(raw.rounds_available) - finite(raw.matches_played)),
      quality_debt: 0,
      partner_diversity: partnerCounts.size,
      opponent_diversity: opponentCounts.size,
      partner_repeat_exposure: repeatExposure(partnerCounts),
      opponent_repeat_exposure: repeatExposure(opponentCounts),
      max_consecutive_rest: consecutiveRest,
      max_consecutive_play: consecutivePlay,
      partner_counts: partnerCounts,
      opponent_counts: opponentCounts,
      consecutive_rest: consecutiveRest,
      consecutive_play: consecutivePlay,
    })
  }
  if (players.size === 0) return null

  const pvna = (playerId: string) => {
    const current = options.pvnaByPlayer?.get(playerId)
    const baseline = baselineById.get(playerId)
    return finite(current ?? baseline?.effective_pvna ?? baseline?.pvna)
  }
  for (const round of options.baselineRounds ?? []) for (const rawMatch of (Array.isArray(round.matches) ? round.matches : []) as PlannedMatch[]) {
    const teamA = ids(rawMatch?.team_a)
    const teamB = ids(rawMatch?.team_b)
    if (!teamA || !teamB) continue
    const teamGap = Math.abs(pvna(teamA[0]) + pvna(teamA[1]) - pvna(teamB[0]) - pvna(teamB[1]))
    const intraA = Math.abs(pvna(teamA[0]) - pvna(teamA[1]))
    const intraB = Math.abs(pvna(teamB[0]) - pvna(teamB[1]))
    teamA.forEach(id => {
      const player = players.get(id)
      if (player) player.quality_debt += Math.max(0, teamGap - options.pvnaTolerance) * 2 + Math.max(0, intraA - 1)
    })
    teamB.forEach(id => {
      const player = players.get(id)
      if (player) player.quality_debt += Math.max(0, teamGap - options.pvnaTolerance) * 2 + Math.max(0, intraB - 1)
    })
  }
  const rounds = [...options.plannedRounds].sort((left, right) => left.round_no - right.round_no)
  const checkpointRounds = new Map<number, number[]>()
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const roundCount = roundIndex + 1
    checkpointRounds.set(roundCount, [roundCount / rounds.length])
  }
  const teamGaps: number[] = []
  const intraGaps: number[] = []
  const checkpoints: RollingPlanCheckpoint[] = []

  rounds.forEach((round, roundIndex) => {
    const played = new Set<string>()
    for (const rawMatch of round.matches as PlannedMatch[]) {
      const teamA = ids(rawMatch?.team_a)
      const teamB = ids(rawMatch?.team_b)
      if (!teamA || !teamB) continue
      const matchIds = [...teamA, ...teamB]
      matchIds.forEach(id => {
        played.add(id)
        const player = players.get(id)
        if (player) player.matches += 1
      })
      updatePair(players, teamA[0], teamA[1], 'partner')
      updatePair(players, teamB[0], teamB[1], 'partner')
      for (const left of teamA) for (const right of teamB) updatePair(players, left, right, 'opponent')

      const teamGap = Math.abs(pvna(teamA[0]) + pvna(teamA[1]) - pvna(teamB[0]) - pvna(teamB[1]))
      const intraA = Math.abs(pvna(teamA[0]) - pvna(teamA[1]))
      const intraB = Math.abs(pvna(teamB[0]) - pvna(teamB[1]))
      teamGaps.push(teamGap)
      intraGaps.push(Math.max(intraA, intraB))
      teamA.forEach(id => {
        const player = players.get(id)
        if (player) player.quality_debt += Math.max(0, teamGap - options.pvnaTolerance) * 2 + Math.max(0, intraA - 1)
      })
      teamB.forEach(id => {
        const player = players.get(id)
        if (player) player.quality_debt += Math.max(0, teamGap - options.pvnaTolerance) * 2 + Math.max(0, intraB - 1)
      })
    }

    const resting = new Set(round.resting)
    for (const [playerId, player] of players) {
      if (played.has(playerId)) {
        player.consecutive_play += 1
        player.consecutive_rest = 0
      } else if (resting.has(playerId)) {
        player.rests += 1
        player.consecutive_rest += 1
        player.consecutive_play = 0
      }
      player.max_consecutive_rest = Math.max(player.max_consecutive_rest, player.consecutive_rest)
      player.max_consecutive_play = Math.max(player.max_consecutive_play, player.consecutive_play)
    }

    for (const ratio of checkpointRounds.get(roundIndex + 1) ?? []) {
      checkpoints.push(checkpoint(ratio, roundIndex + 1, players))
    }
  })

  const percentile = (values: number[], ratio: number) => {
    if (values.length === 0) return null
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]
  }
  const finalPlayers = Object.fromEntries([...players].map(([id, player]) => [id, playerTarget(player)]))
  return {
    plan_version_id: options.planVersionId,
    target_matches_by_player: Object.fromEntries(
      Object.entries(finalPlayers).map(([id, target]) => [id, target.matches]),
    ),
    preferred_team_gap: percentile(teamGaps, 0.95),
    preferred_intra_team_gap: percentile(intraGaps, 0.95),
    players: finalPlayers,
    checkpoints,
  }
}
