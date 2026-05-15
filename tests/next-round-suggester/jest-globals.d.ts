type JestMatcher = {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toContain(expected: unknown): void
  toHaveLength(expected: number): void
  toBeGreaterThan(expected: number): void
  toBeGreaterThanOrEqual(expected: number): void
  toBeLessThan(expected: number): void
  toBeLessThanOrEqual(expected: number): void
  toBeNull(): void
  toBeUndefined(): void
  toBeTruthy(): void
  not: JestMatcher
}

declare const describe: {
  (name: string, fn: () => void): void
  each<T>(cases: readonly T[]): (name: string, fn: (value: T) => void) => void
}

declare const it: {
  (name: string, fn: () => void): void
  each<T>(cases: readonly T[]): (name: string, fn: (value: T) => void) => void
}

declare const expect: {
  (value: unknown): JestMatcher
  arrayContaining(values: unknown[]): unknown
  extend(matchers: Record<string, unknown>): void
}

declare namespace jest {
  interface Matchers<R> {
    toHaveValidMatch(): R
    toRespectPvnaTolerance(tolerance: number, pvnaByPlayer: Map<string, number>): R
    toIncludePlayer(playerId: string): R
  }
}
