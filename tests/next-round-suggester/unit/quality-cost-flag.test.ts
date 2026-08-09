import {
  isQualityCostModelEnabled,
  resolveQualityCostEnabledForSession,
  __setQualityCostModelOverrideForTests,
} from '../../../lib/next-round-suggester/quality-cost-flag'

const ENV = 'SESSION_QUALITY_COST_MODEL'
const ALLOW = 'SESSION_QUALITY_COST_SESSION_IDS'

afterEach(() => {
  __setQualityCostModelOverrideForTests(null)
  delete process.env[ENV]
  delete process.env[ALLOW]
})

describe('resolveQualityCostEnabledForSession — strict per-session allowlist', () => {
  it('flag off → false regardless of allowlist', () => {
    process.env[ALLOW] = 's-123,*'
    expect(resolveQualityCostEnabledForSession('s-123')).toBe(false)
  })

  it('flag on + empty allowlist → false (strict: no session enabled)', () => {
    process.env[ENV] = '1'
    expect(resolveQualityCostEnabledForSession('s-123')).toBe(false)
  })

  it('flag on + session in allowlist → true only for that session', () => {
    process.env[ENV] = '1'
    process.env[ALLOW] = 's-123, s-999'
    expect(resolveQualityCostEnabledForSession('s-123')).toBe(true)
    expect(resolveQualityCostEnabledForSession('s-999')).toBe(true)
    expect(resolveQualityCostEnabledForSession('s-other')).toBe(false)
  })

  it('flag on + wildcard → true for any session', () => {
    process.env[ENV] = '1'
    process.env[ALLOW] = '*'
    expect(resolveQualityCostEnabledForSession('anything')).toBe(true)
  })
})

describe('isQualityCostModelEnabled — precedence: override > state.config > env', () => {
  it('test override wins over everything', () => {
    process.env[ENV] = '1'
    __setQualityCostModelOverrideForTests(false)
    expect(isQualityCostModelEnabled({ config: { quality_cost_enabled: true } } as never)).toBe(false)
    __setQualityCostModelOverrideForTests(true)
    expect(isQualityCostModelEnabled()).toBe(true)
  })

  it('state.config.quality_cost_enabled wins over env when no override', () => {
    process.env[ENV] = '1'
    expect(isQualityCostModelEnabled({ config: { quality_cost_enabled: false } } as never)).toBe(false)
    delete process.env[ENV]
    expect(isQualityCostModelEnabled({ config: { quality_cost_enabled: true } } as never)).toBe(true)
  })

  it('treats missing state/config as OFF, even when the env flag is set', () => {
    expect(isQualityCostModelEnabled()).toBe(false)
    process.env[ENV] = '1'
    expect(isQualityCostModelEnabled()).toBe(false)
    expect(isQualityCostModelEnabled({ config: {} } as never)).toBe(false)
  })
})
