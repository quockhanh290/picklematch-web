// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { RollingPlanPlayerTarget, RollingPlanTarget } from './rolling-horizon.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState, SuggestionAlternative } from '../types.ts'

export type ActiveRollingInvariantTarget = {
  target_total_appearances: number
  players: Record<string, Partial<RollingPlanPlayerTarget> & { matches: number }>
}

function targetAppearances(players: Record<string, Partial<RollingPlanPlayerTarget> & { matches: number }>) {
  return Object.values(players).reduce((sum, player) => sum + Number(player.matches || 0), 0)
}

export function getActiveRollingInvariantTarget(
  state: SessionState,
  planTarget?: RollingPlanTarget | null,
): ActiveRollingInvariantTarget | null {
  if (!planTarget) return null
  const currentAppearances = Object.keys(planTarget.target_matches_by_player)
    .reduce((sum, playerId) => sum + (state.players.get(playerId)?.matches_played ?? 0), 0)
  const checkpoint = planTarget.checkpoints
    ?.find(item => item.target_total_appearances > currentAppearances)
  if (checkpoint) {
    return {
      target_total_appearances: checkpoint.target_total_appearances,
      players: checkpoint.players,
    }
  }
  const finalPlayers = planTarget.players ?? Object.fromEntries(
    Object.entries(planTarget.target_matches_by_player).map(([id, matches]) => [id, { matches }]),
  )
  const finalAppearances = targetAppearances(finalPlayers)
  if (currentAppearances >= finalAppearances) return null
  return {
    target_total_appearances: finalAppearances,
    players: finalPlayers,
  }
}

export function getRollingInvariantProtectedIds(
  state: SessionState,
  planTarget?: RollingPlanTarget | null,
) {
  const activeTarget = getActiveRollingInvariantTarget(state, planTarget)
  if (!activeTarget) return new Set<string>()
  return new Set(Object.entries(activeTarget.players)
    .filter(([playerId, target]) => (
      (state.players.get(playerId)?.matches_played ?? 0) >= target.matches
    ))
    .map(([playerId]) => playerId))
}

export function getRollingInvariantViolations(options: {
  alternative: SuggestionAlternative
  state: SessionState
  requiredPlayerIds?: ReadonlySet<string>
  planTarget?: RollingPlanTarget | null
}) {
  const selectedIds = new Set(options.alternative.matches.flatMap(match => [
    ...match.team_a,
    ...match.team_b,
  ]))
  const violations: string[] = []
  for (const playerId of options.requiredPlayerIds ?? []) {
    if (!selectedIds.has(playerId)) violations.push(`missing_required_player:${playerId}`)
  }
  const activeTarget = getActiveRollingInvariantTarget(options.state, options.planTarget)
  if (!activeTarget) return violations
  for (const playerId of selectedIds) {
    const target = activeTarget.players[playerId]
    if (!target) {
      violations.push(`missing_plan_target:${playerId}`)
      continue
    }
    const projectedMatches = (options.state.players.get(playerId)?.matches_played ?? 0) + 1
    if (projectedMatches > target.matches) {
      violations.push(`plan_match_cap_exceeded:${playerId}`)
    }
  }
  return violations
}

export function filterRollingInvariantAlternatives(options: {
  alternatives: SuggestionAlternative[]
  state: SessionState
  requiredPlayerIds?: ReadonlySet<string>
  planTarget?: RollingPlanTarget | null
}) {
  return options.alternatives.filter(alternative => getRollingInvariantViolations({
    alternative,
    state: options.state,
    requiredPlayerIds: options.requiredPlayerIds,
    planTarget: options.planTarget,
  }).length === 0)
}
