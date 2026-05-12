import { buildRoundRobinDoublesSchedule, type RoundRobinScheduleOptions } from './roundRobinScheduler'

type WorkerRequest = {
  requestId: number
  playerIds: string[]
  courtCount: number
  rounds?: number
  options?: RoundRobinScheduleOptions
}

type WorkerResponse = {
  requestId: number
  ok: boolean
  schedule?: ReturnType<typeof buildRoundRobinDoublesSchedule>
  error?: string
}

const ctx: Worker = self as any

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, playerIds, courtCount, rounds, options } = event.data
  try {
    const schedule = buildRoundRobinDoublesSchedule(playerIds, courtCount, rounds, options)
    ctx.postMessage({ requestId, ok: true, schedule } satisfies WorkerResponse)
  } catch (error: any) {
    ctx.postMessage({
      requestId,
      ok: false,
      error: error?.message || 'Failed to build schedule',
    } satisfies WorkerResponse)
  }
}
