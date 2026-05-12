import { buildRoundRobinDoublesSchedule, type RoundRobinSchedule, type RoundRobinScheduleOptions } from './roundRobinScheduler'

export async function buildRoundRobinDoublesScheduleAsync(
  playerIds: string[],
  courtCount: number,
  rounds?: number,
  options: RoundRobinScheduleOptions = {}
): Promise<RoundRobinSchedule> {
  // Metro currently does not support bundling this scheduler worker safely in Expo dev.
  // Keep the async boundary so HostMatchScreen does not care whether we later swap in a worker.
  return buildRoundRobinDoublesSchedule(playerIds, courtCount, rounds, options)
}
