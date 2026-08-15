// Countable search budget: the engine truncates its search on work done, never on the wall clock.
//
// A clock budget makes the same input produce different lineups on a loaded machine — the host sees it
// as "same bench, different teams", and it makes every A/B measurement on the engine unrepeatable. One
// unit = one partition evaluated (pair.ts `consider`), which is where the search actually spends.
//
// Budgets nest: a child holds its own cap AND spends against its parents, so `min(remaining ...)` and
// "reserve a slice for the rescue pass" both fall out of the same primitive.

export type SearchBudget = {
  limit: number
  used: number
  parents: SearchBudget[]
  /**
   * Wall-clock safety net, in Date.now() terms. NOT the budget — the unit count above is.
   *
   * One unit is one partition evaluated, but a partition is not a fixed amount of work: late in a
   * session, with a full pool and eight rounds of pair history, each evaluation walks much longer count
   * maps. Measured on a real stuck session (32 free players, 6 empty courts, 8 rounds): the batch budget
   * meant to buy 3800ms bought 14157ms, against 2806ms for the clock-budgeted engine it replaced.
   *
   * So the units keep the result machine-independent in the normal case, and this stops the pathological
   * one. It only binds when the exchange rate collapses, and when it binds the result stops being
   * deterministic — that is the deliberate trade, and it is the rarer failure.
   */
  deadlineAt?: number
}

export const UNLIMITED_SEARCH_UNITS = Number.POSITIVE_INFINITY

export function createSearchBudget(
  limit: number,
  parents: SearchBudget[] = [],
  deadlineAt?: number,
): SearchBudget {
  return {
    limit: Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : UNLIMITED_SEARCH_UNITS,
    used: 0,
    parents,
    deadlineAt,
  }
}

export function subSearchBudget(parent: SearchBudget, cap: number): SearchBudget {
  return createSearchBudget(cap, [parent])
}

export function searchBudgetRemaining(budget: SearchBudget | undefined): number {
  if (!budget) return UNLIMITED_SEARCH_UNITS
  let remaining = budget.limit - budget.used
  if (remaining <= 0) return 0
  // Sampled, not per-call: reading the clock on every partition evaluation is the cost this whole
  // change removed. Once every 512 spends is far finer than the millisecond scale being guarded.
  if (budget.deadlineAt !== undefined && (budget.used & 511) === 0 && Date.now() >= budget.deadlineAt) {
    budget.used = budget.limit
    return 0
  }
  for (const parent of budget.parents) {
    const parentRemaining = searchBudgetRemaining(parent)
    if (parentRemaining <= 0) return 0
    if (parentRemaining < remaining) remaining = parentRemaining
  }
  return remaining
}

export function searchBudgetExhausted(budget: SearchBudget | undefined): boolean {
  return searchBudgetRemaining(budget) <= 0
}

export function spendSearchBudget(budget: SearchBudget | undefined, units = 1): void {
  if (!budget) return
  budget.used += units
  for (const parent of budget.parents) {
    spendSearchBudget(parent, units)
  }
}

export function searchBudgetSpent(budget: SearchBudget | undefined): number {
  return budget ? budget.used : 0
}
