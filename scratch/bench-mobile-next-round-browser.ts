import { chromium, devices, type ConsoleMessage, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

type Args = {
  baseUrl: string
  sessionId: string | null
  device: 'pixel' | 'iphone'
  mutate: boolean
  flow: 'load' | 'one-match'
  courts: number
  targetRounds: number
}

type SupabaseAny = any

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

function argValue(name: string, fallback: string | null = null) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function parseArgs(): Args {
  const device = (argValue('--device', 'pixel') ?? 'pixel') as Args['device']
  if (!['pixel', 'iphone'].includes(device)) throw new Error('--device must be pixel or iphone')
  const flow = (argValue('--flow', process.argv.includes('--mutate') ? 'one-match' : 'load') ?? 'load') as Args['flow']
  if (!['load', 'one-match'].includes(flow)) throw new Error('--flow must be load or one-match')
  return {
    baseUrl: argValue('--base-url', 'http://127.0.0.1:4173')!,
    sessionId: argValue('--session-id'),
    device,
    mutate: process.argv.includes('--mutate'),
    flow,
    courts: Math.max(1, Number(argValue('--courts', '6'))),
    targetRounds: Math.max(1, Number(argValue('--target-rounds', '8'))),
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function supabaseStorageKey() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL')
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
  return `sb-${projectRef}-auth-token`
}

async function signIn() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: HOST_EMAIL, password: HOST_PASSWORD }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Host login failed (${response.status}): ${body}`)
  const data = JSON.parse(body)
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    accessToken: String(data.access_token),
    userId: String(data.user.id),
    storageSession: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      expires_at: data.expires_at ?? nowSeconds + Number(data.expires_in ?? 3600),
      user: data.user,
    },
  }
}

async function latestHostSessionId(client: SupabaseAny, hostUserId: string) {
  const { data, error } = await client
    .from('sessions')
    .select('id, created_at, status')
    .eq('host_id', hostUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error(`No session found for ${HOST_EMAIL}`)
  return String(data.id)
}

async function saveNextRoundSettings(client: SupabaseAny, sessionId: string, hostUserId: string, args: Args) {
  const { error } = await client
    .from('session_next_round_settings')
    .upsert({
      session_id: sessionId,
      court_count_override: args.courts,
      court_preset: 'balanced',
      court_duration_min: 120,
      pvna_tolerance: 0.5,
      target_rounds: args.targetRounds,
      updated_by: hostUserId,
    }, { onConflict: 'session_id' })
  if (error) throw error
}

async function waitForAny(page: Page, selectors: string[], timeoutMs: number) {
  const startedAt = now()
  while (now() - startedAt < timeoutMs) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if (await locator.isVisible({ timeout: 250 }).catch(() => false)) return selector
    }
  }
  throw new Error(`Timed out waiting for any selector: ${selectors.join(', ')}`)
}

async function clickTextAndMeasure(page: Page, label: RegExp, waitForNextLabel: RegExp) {
  const button = page.getByText(label).first()
  const before = await button.textContent().catch(() => null)
  const t0 = now()
  await button.scrollIntoViewIfNeeded().catch(() => {})
  await button.click({ force: true, timeout: 10_000 })
  const clickMs = now() - t0
  await page.getByText(waitForNextLabel).first().waitFor({ state: 'visible', timeout: 45_000 })
  return {
    before,
    clickMs,
    settledMs: now() - t0,
  }
}

async function completeFirstVisibleMatch(page: Page) {
  const button = page.getByText(/KẾT THÚC TRẬN/i).first()
  const before = await button.textContent().catch(() => null)
  const t0 = now()
  await button.scrollIntoViewIfNeeded().catch(() => {})
  await button.click({ force: true, timeout: 10_000 })
  const clickMs = now() - t0
  await page.getByText(/ĐANG KẾT THÚC/i).first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  await page.getByText(/ĐANG KẾT THÚC/i).first().waitFor({ state: 'hidden', timeout: 45_000 })
  return {
    before,
    clickMs,
    settledMs: now() - t0,
  }
}

async function main() {
  const args = parseArgs()
  const auth = await signIn()
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  })
  const sessionId = args.sessionId ?? await latestHostSessionId(client, auth.userId)
  await saveNextRoundSettings(client, sessionId, auth.userId, args)
  const device = args.device === 'iphone' ? devices['iPhone 14'] : devices['Pixel 7']
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    ...device,
    baseURL: args.baseUrl,
  })
  await context.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session))
    },
    { key: supabaseStorageKey(), session: auth.storageSession },
  )

  const page = await context.newPage()
  const consoleRows: Array<{ type: string; text: string }> = []
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text()
    if (text.includes('NextRoundSuggesterV2') || text.includes('next-round-route')) {
      consoleRows.push({ type: message.type(), text })
    }
  })

  const url = `/host/session/${sessionId}/next-round?bootstrap=light`
  const t0 = now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const domContentLoadedMs = now() - t0
  await page.getByTestId('nrv2-screen').waitFor({ state: 'visible', timeout: 45_000 })
  const screenVisibleMs = now() - t0
  let readySelector: string
  try {
    readySelector = await waitForAny(page, [
      '[data-testid="nrv2-alt-tab-0"]',
      '[data-testid="nrv2-sync-btn"]',
      '[data-testid="nrv2-cta-primary"]',
      '[data-testid="nrv2-roster-link"]',
      '[data-testid="nrv2-settings-chip"]',
    ], 75_000)
  } catch (error) {
    const testIds = await page.locator('[data-testid]').evaluateAll(nodes =>
      nodes.map(node => (node as HTMLElement).dataset.testid).filter(Boolean).slice(0, 50),
    ).catch(() => [])
    const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible testIDs=${JSON.stringify(testIds)}\nBody=${bodyText.slice(0, 1000)}`)
  }
  const firstReadyMs = now() - t0

  const cta = page.getByTestId('nrv2-cta-primary')
  const ctaText = await cta.textContent().catch(() => null)
  let mutateResult: null | Record<string, unknown> = null

  if (args.mutate || args.flow === 'one-match') {
    const startCount = await page.getByText(/BẮT ĐẦU TRẬN/i).count().catch(() => 0)
    if (startCount > 0) {
      const start = await clickTextAndMeasure(page, /BẮT ĐẦU TRẬN/i, /KẾT THÚC TRẬN/i)
      await page.waitForTimeout(600)
      const complete = await completeFirstVisibleMatch(page)
      mutateResult = {
        flow: 'one-match',
        start: {
          ...start,
          clickMs: Math.round(start.clickMs),
          settledMs: Math.round(start.settledMs),
        },
        complete: {
          ...complete,
          clickMs: Math.round(complete.clickMs),
          settledMs: Math.round(complete.settledMs),
        },
      }
    } else {
      mutateResult = { flow: 'one-match', error: 'No visible BẮT ĐẦU TRẬN button' }
    }
  } else if (args.mutate) {
    const beforeLabel = ctaText
    const clickT0 = now()
    await cta.click({ force: true })
    await page.locator('[data-testid="nrv2-cta-primary"] [role="progressbar"], [data-testid="nrv2-cta-primary"]')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {})
    const clickToBusyMs = now() - clickT0
    await page.waitForTimeout(500)
    await page.waitForLoadState('networkidle', { timeout: 35_000 }).catch(() => {})
    const clickToSettledMs = now() - clickT0
    mutateResult = {
      label: beforeLabel,
      clickToBusyMs,
      clickToSettledMs,
      nextLabel: await cta.textContent().catch(() => null),
    }
  }

  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return entry ? {
      responseStart: entry.responseStart,
      domContentLoaded: entry.domContentLoadedEventEnd,
      load: entry.loadEventEnd,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    } : null
  })
  const visibleTestIds = await page.locator('[data-testid]').evaluateAll(nodes =>
    nodes
      .filter(node => {
        const element = node as HTMLElement
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      })
      .map(node => (node as HTMLElement).dataset.testid)
      .filter(Boolean)
      .slice(0, 80),
  ).catch(() => [])
  const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')

  const result = {
    sessionId,
    host: HOST_EMAIL,
    device: args.device,
    flow: args.flow,
    courts: args.courts,
    targetRounds: args.targetRounds,
    baseUrl: args.baseUrl,
    mutate: args.mutate,
    url,
    timings: {
      domContentLoadedMs: Math.round(domContentLoadedMs),
      screenVisibleMs: Math.round(screenVisibleMs),
      firstReadyMs: Math.round(firstReadyMs),
    },
    readySelector,
    ctaText,
    mutateResult,
    navigation: nav ? {
      responseStart: Math.round(nav.responseStart),
      domContentLoaded: Math.round(nav.domContentLoaded),
      load: Math.round(nav.load),
      transferSize: nav.transferSize,
      encodedBodySize: nav.encodedBodySize,
    } : null,
    visibleTestIds,
    bodyPreview: bodyText.slice(0, 1200),
    console: consoleRows.slice(-20),
  }

  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
