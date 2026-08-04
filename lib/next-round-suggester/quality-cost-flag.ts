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

export function isQualityCostModelEnabled(): boolean {
  if (testOverride !== null) return testOverride
  const value = readEnvValue('SESSION_QUALITY_COST_MODEL')
  return value === '1' || value === 'true'
}

// Test-only hook: force the flag on/off, or pass null to restore env-driven reads.
export function __setQualityCostModelOverrideForTests(value: boolean | null): void {
  testOverride = value
}
