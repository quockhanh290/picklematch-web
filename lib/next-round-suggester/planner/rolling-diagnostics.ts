export type RollingHorizonEventDetail = {
  court: number | null
  candidates: number | null
  evaluated: number | null
  orders: number | null
  depth: number | null
  calls: number | null
  cache: number | null
  exhausted: boolean
  elapsed_ms: number | null
  selected_candidate_index: number | null
  selected_quality_cost: number | null
  selected_fairness_cost: number | null
  selected_flexibility_cost: number | null
  selected_score: number | null
  selected_worst_score: number | null
  paths_without_future: number | null
  best_rejected_candidate_index: number | null
  best_rejected_delta: number | null
  best_rejected_worst_score: number | null
}

function finite(value: string | undefined) {
  if (value === undefined || value === 'na') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseRollingHorizonDetail(detail: string): RollingHorizonEventDetail | null {
  const fields = new Map(detail.split(';').flatMap(part => {
    const separator = part.indexOf('=')
    return separator > 0 ? [[part.slice(0, separator), part.slice(separator + 1)]] : []
  }))
  if (!fields.has('court') || !fields.has('score')) return null
  return {
    court: finite(fields.get('court')),
    candidates: finite(fields.get('candidates')),
    evaluated: finite(fields.get('evaluated')),
    orders: finite(fields.get('orders')),
    depth: finite(fields.get('depth')),
    calls: finite(fields.get('calls')),
    cache: finite(fields.get('cache')),
    exhausted: fields.get('exhausted') === '1',
    elapsed_ms: finite(fields.get('elapsed')),
    selected_candidate_index: finite(fields.get('pick')),
    selected_quality_cost: finite(fields.get('quality')),
    selected_fairness_cost: finite(fields.get('fairness')),
    selected_flexibility_cost: finite(fields.get('flex')),
    selected_score: finite(fields.get('score')),
    selected_worst_score: finite(fields.get('worst')),
    paths_without_future: finite(fields.get('no_future')),
    best_rejected_candidate_index: finite(fields.get('reject')),
    best_rejected_delta: finite(fields.get('reject_delta')),
    best_rejected_worst_score: finite(fields.get('reject_worst')),
  }
}

function average(values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => value !== null)
  return finiteValues.length > 0
    ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
    : null
}

export function summarizeRollingHorizonDetails(details: string[]) {
  const rows = details
    .map(parseRollingHorizonDetail)
    .filter((row): row is RollingHorizonEventDetail => row !== null)
  const elapsed = rows.flatMap(row => row.elapsed_ms === null ? [] : [row.elapsed_ms])
  const rejectedDeltas = rows.flatMap(row => row.best_rejected_delta === null ? [] : [row.best_rejected_delta])
  return {
    decisions: rows.length,
    budget_exhausted: rows.filter(row => row.exhausted).length,
    avg_elapsed_ms: average(rows.map(row => row.elapsed_ms)),
    max_elapsed_ms: elapsed.length > 0 ? Math.max(...elapsed) : null,
    future_search_calls: rows.reduce((sum, row) => sum + (row.calls ?? 0), 0),
    future_cache_hits: rows.reduce((sum, row) => sum + (row.cache ?? 0), 0),
    paths_without_future: rows.reduce((sum, row) => sum + (row.paths_without_future ?? 0), 0),
    avg_best_rejected_delta: average(rows.map(row => row.best_rejected_delta)),
    close_decisions_delta_lte_5: rejectedDeltas.filter(delta => delta <= 5).length,
    decisions_without_rejected_candidate: rows.filter(row => (
      row.best_rejected_candidate_index === null || row.best_rejected_candidate_index < 0
    )).length,
  }
}
