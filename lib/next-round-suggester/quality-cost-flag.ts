// Reads the SESSION_QUALITY_COST_MODEL rollout flag. Must be safe in both the Deno edge runtime
// (Deno.env) and Node/Jest (process.env) — never throw in either, and never assume the other exists.
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
// Structural param avoids importing SessionState (this module is imported by the central score.ts).
export function isQualityCostModelEnabled(state?: { config?: { quality_cost_enabled?: boolean } }): boolean {
  if (testOverride !== null) return testOverride
  const scoped = state?.config?.quality_cost_enabled
  if (scoped != null) return scoped
  return false
}

// Resolve the flag for one session at the request boundary (edge handler). Strict allowlist: the global
// flag must be '1'/'true' AND the session must be listed in SESSION_QUALITY_COST_SESSION_IDS (comma-
// separated) or the list must contain '*'. An empty allowlist enables NO session. Mirrors the edge's
// planRolloutEnabled pattern. The result is stored on state.config.quality_cost_enabled.
export function resolveQualityCostEnabledForSession(sessionId: string): boolean {
  const flag = readEnvValue('SESSION_QUALITY_COST_MODEL')
  if (flag !== '1' && flag !== 'true') return false
  const allowlist = (readEnvValue('SESSION_QUALITY_COST_SESSION_IDS') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return allowlist.includes('*') || allowlist.includes(sessionId)
}

// Test-only hook: force the flag on/off, or pass null to restore env-driven reads.
export function __setQualityCostModelOverrideForTests(value: boolean | null): void {
  testOverride = value
}
