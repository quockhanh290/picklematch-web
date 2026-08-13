// Reads the SESSION_BOARD_OPTIMIZER rollout flag. Must be safe in both the Deno edge runtime
// (Deno.env) and Node/Jest (process.env) — never throw in either, and never assume the other exists.
// Same shape as quality-cost-flag.ts on purpose: one rollout pattern, one place to reason about.
let testOverride: boolean | null = null

function readEnvValue(name: string): string | undefined {
  const denoGlobal = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno
  if (denoGlobal?.env?.get) {
    return denoGlobal.env.get(name) ?? undefined
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}

// Reads the resolved flag. Precedence: test override > the session-scoped flag carried on state.config.
// Missing state/config is OFF: request boundaries must resolve the per-session allowlist explicitly.
export function isBoardOptimizerEnabled(state?: { config?: { board_optimizer_enabled?: boolean } }): boolean {
  if (testOverride !== null) return testOverride
  const scoped = state?.config?.board_optimizer_enabled
  if (scoped != null) return scoped
  return false
}

// Resolve the flag for one session at the request boundary (edge handler). Strict allowlist: the global
// flag must be '1'/'true' AND the session must be listed in SESSION_BOARD_OPTIMIZER_SESSION_IDS (comma-
// separated) or the list must contain '*'. An empty allowlist enables NO session. The result is stored
// on state.config.board_optimizer_enabled.
export function resolveBoardOptimizerEnabledForSession(sessionId: string): boolean {
  const flag = readEnvValue('SESSION_BOARD_OPTIMIZER')
  if (flag !== '1' && flag !== 'true') return false
  const allowlist = (readEnvValue('SESSION_BOARD_OPTIMIZER_SESSION_IDS') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return allowlist.includes('*') || allowlist.includes(sessionId)
}

// Test-only hook: force the flag on/off, or pass null to restore env-driven reads.
export function __setBoardOptimizerOverrideForTests(value: boolean | null): void {
  testOverride = value
}
