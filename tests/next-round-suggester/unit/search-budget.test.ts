import {
  UNLIMITED_SEARCH_UNITS,
  createSearchBudget,
  searchBudgetExhausted,
  searchBudgetRemaining,
  searchBudgetSpent,
  spendSearchBudget,
  subSearchBudget,
} from '@/lib/next-round-suggester/search-budget'

describe('search budget', () => {
  it('counts down from its limit', () => {
    const budget = createSearchBudget(10)
    expect(searchBudgetRemaining(budget)).toBe(10)
    spendSearchBudget(budget, 4)
    expect(searchBudgetRemaining(budget)).toBe(6)
    expect(searchBudgetSpent(budget)).toBe(4)
    expect(searchBudgetExhausted(budget)).toBe(false)
  })

  it('is exhausted at zero and never reports negative remaining', () => {
    const budget = createSearchBudget(3)
    spendSearchBudget(budget, 5)
    expect(searchBudgetExhausted(budget)).toBe(true)
    expect(searchBudgetRemaining(budget)).toBe(0)
  })

  it('treats an absent budget as unlimited', () => {
    expect(searchBudgetRemaining(undefined)).toBe(UNLIMITED_SEARCH_UNITS)
    expect(searchBudgetExhausted(undefined)).toBe(false)
    expect(() => spendSearchBudget(undefined, 100)).not.toThrow()
  })

  it('a child spends against its parent', () => {
    const parent = createSearchBudget(10)
    const child = subSearchBudget(parent, 4)
    spendSearchBudget(child, 4)
    expect(searchBudgetExhausted(child)).toBe(true)
    expect(searchBudgetRemaining(parent)).toBe(6)
    expect(searchBudgetExhausted(parent)).toBe(false)
  })

  it('a child never outlives an exhausted parent', () => {
    const parent = createSearchBudget(2)
    const child = subSearchBudget(parent, 100)
    spendSearchBudget(parent, 2)
    expect(searchBudgetExhausted(child)).toBe(true)
    expect(searchBudgetRemaining(child)).toBe(0)
  })

  it('spends against every parent when a budget has more than one', () => {
    const court = createSearchBudget(10)
    const forced = createSearchBudget(3)
    const combined = createSearchBudget(UNLIMITED_SEARCH_UNITS, [court, forced])
    spendSearchBudget(combined, 3)
    expect(searchBudgetExhausted(combined)).toBe(true)
    expect(searchBudgetRemaining(court)).toBe(7)
    expect(searchBudgetRemaining(forced)).toBe(0)
  })

  it('an unlimited budget is never exhausted', () => {
    const budget = createSearchBudget(UNLIMITED_SEARCH_UNITS)
    spendSearchBudget(budget, 1_000_000)
    expect(searchBudgetExhausted(budget)).toBe(false)
  })

  it('does not read the clock', () => {
    const budget = createSearchBudget(5)
    const now = Date.now
    Date.now = () => {
      throw new Error('search budget must not read the clock')
    }
    try {
      spendSearchBudget(budget, 1)
      expect(searchBudgetRemaining(budget)).toBe(4)
    } finally {
      Date.now = now
    }
  })
})
