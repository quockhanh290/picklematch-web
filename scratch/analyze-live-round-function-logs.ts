type FunctionTiming = {
  kind: 'start' | 'end'
  versioned: boolean
  total: number
  auth?: number
  loadSessionState?: number
  dbWrites?: number
  correctForFairness?: number
  validateAndScoreBefore?: number
  readBody?: number
  createClient?: number
  rpc?: number
  round?: number
}

type LoadTiming = {
  kind: 'start' | 'end'
  total: number
  playersQuery: number
  pairsQuery: number
  roundsQuery: number
  preferencesQuery: number
  players?: number
  pairs?: number
  rounds?: number
}

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'mzqsxgfvtgmsscbqugni'
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function numberField(message: string, field: string): number | undefined {
  const match = message.match(new RegExp(`${field}:\\s*(-?\\d+)`))
  return match ? Number(match[1]) : undefined
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summary(values: number[]) {
  if (values.length === 0) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    avg: Math.round(sum / values.length),
  }
}

function parseFunctionTiming(message: string): FunctionTiming | null {
  const versioned = message.includes('[session-rounds-start-versioned] timing')
    || message.includes('[session-rounds-end-versioned] timing')
  const kind = message.includes('[session-rounds-start] timing') || message.includes('[session-rounds-start-versioned] timing')
    ? 'start'
    : message.includes('[session-rounds-end] timing') || message.includes('[session-rounds-end-versioned] timing')
      ? 'end'
      : null
  if (!kind) return null

  const total = numberField(message, 'total')
  if (total === undefined) return null
  return {
    kind,
    versioned,
    total,
    auth: numberField(message, 'auth'),
    loadSessionState: numberField(message, 'loadSessionState'),
    dbWrites: numberField(message, 'dbWrites'),
    correctForFairness: numberField(message, 'correctForFairness'),
    validateAndScoreBefore: numberField(message, 'validateAndScoreBefore'),
    readBody: numberField(message, 'readBody'),
    createClient: numberField(message, 'createClient'),
    rpc: numberField(message, 'rpc'),
    round: numberField(message, 'round'),
  }
}

function parseLoadTiming(message: string): LoadTiming | null {
  const kind = message.includes('[session-rounds-start] loadSessionState detail')
    ? 'start'
    : message.includes('[session-rounds-end] loadSessionState detail')
      ? 'end'
      : null
  if (!kind) return null

  const total = numberField(message, 'total')
  const playersQuery = numberField(message, 'playersQuery')
  const pairsQuery = numberField(message, 'pairsQuery')
  const roundsQuery = numberField(message, 'roundsQuery')
  const preferencesQuery = numberField(message, 'preferencesQuery')
  if (
    total === undefined ||
    playersQuery === undefined ||
    pairsQuery === undefined ||
    roundsQuery === undefined ||
    preferencesQuery === undefined
  ) {
    return null
  }

  return {
    kind,
    total,
    playersQuery,
    pairsQuery,
    roundsQuery,
    preferencesQuery,
    players: numberField(message, 'players'),
    pairs: numberField(message, 'pairs'),
    rounds: numberField(message, 'rounds'),
  }
}

function printTiming(title: string, rows: FunctionTiming[]) {
  console.log(`\n${title}`)
  console.table({
    total: summary(rows.map((row) => row.total)),
    auth: summary(rows.map((row) => row.auth).filter((value): value is number => value !== undefined)),
    loadSessionState: summary(rows.map((row) => row.loadSessionState).filter((value): value is number => value !== undefined)),
    dbWrites: summary(rows.map((row) => row.dbWrites).filter((value): value is number => value !== undefined)),
    readBody: summary(rows.map((row) => row.readBody).filter((value): value is number => value !== undefined)),
    createClient: summary(rows.map((row) => row.createClient).filter((value): value is number => value !== undefined)),
    rpc: summary(rows.map((row) => row.rpc).filter((value): value is number => value !== undefined)),
  })
}

function printLoad(title: string, rows: LoadTiming[]) {
  console.log(`\n${title}`)
  console.table({
    total: summary(rows.map((row) => row.total)),
    playersQuery: summary(rows.map((row) => row.playersQuery)),
    pairsQuery: summary(rows.map((row) => row.pairsQuery)),
    roundsQuery: summary(rows.map((row) => row.roundsQuery)),
    preferencesQuery: summary(rows.map((row) => row.preferencesQuery)),
  })
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error('Missing SUPABASE_ACCESS_TOKEN')
  }

  const hours = Math.max(1, Number(argValue('--hours', '3')))
  const limit = Math.max(1, Number(argValue('--limit', '300')))
  const end = new Date()
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
  const sql = `
select timestamp, event_message
from function_logs
where event_message like '%session-rounds-%'
order by timestamp desc
limit ${limit}
`.trim()

  const params = new URLSearchParams({
    iso_timestamp_start: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    iso_timestamp_end: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sql,
  })
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?${params}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  })
  const payload = await response.json()
  if (!response.ok || payload.error) {
    throw new Error(JSON.stringify(payload.error ?? payload))
  }

  const messages = (payload.result ?? []).map((row: { event_message: string }) => row.event_message)
  const timings = messages.map(parseFunctionTiming).filter((row): row is FunctionTiming => Boolean(row))
  const loads = messages.map(parseLoadTiming).filter((row): row is LoadTiming => Boolean(row))

  console.log(JSON.stringify({
    projectRef: PROJECT_REF,
    hours,
    rawLogRows: messages.length,
    timingRows: timings.length,
    loadRows: loads.length,
  }, null, 2))

  printTiming('start timing', timings.filter((row) => row.kind === 'start'))
  printTiming('end timing', timings.filter((row) => row.kind === 'end'))
  printTiming('versioned start timing', timings.filter((row) => row.kind === 'start' && row.versioned))
  printTiming('versioned end timing', timings.filter((row) => row.kind === 'end' && row.versioned))
  printLoad('start loadSessionState detail', loads.filter((row) => row.kind === 'start'))
  printLoad('end loadSessionState detail', loads.filter((row) => row.kind === 'end'))

  const slowest = [...timings].sort((a, b) => b.total - a.total).slice(0, 10)
  console.log('\nslowest function calls')
  console.table(slowest)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
