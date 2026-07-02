import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

type LiveRow = {
  id: string
  session_id: string
  sequence_no: number
  round_no: number | null
  court_idx: number | null
  status: 'suggested' | 'live' | 'completed' | 'cancelled'
  team_a: string[]
  team_b: string[]
  resting: string[]
  score_a: number
  score_b: number
}

type E2EContext = {
  service: SupabaseClient<any, 'public', any>
  host: SupabaseClient<any, 'public', any>
  sessionId: string
  playerIds: string[]
}

const SOURCE_SESSION_FALLBACK = '55555555-5555-5555-5555-555555555570'
const HOST_EMAIL = process.env.E2E_HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.E2E_HOST_PASSWORD ?? process.env.E2E_DUMMY_PASSWORD ?? '123456'

function readEnv(key: string) {
  if (process.env[key]) return process.env[key]
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return undefined
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    if (trimmed.slice(0, idx).trim() === key) {
      return trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
    }
  }
  return undefined
}

function supabaseUrl() {
  return readEnv('EXPO_PUBLIC_SUPABASE_URL') ?? readEnv('SUPABASE_URL')
}

function anonKey() {
  return readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') ?? readEnv('SUPABASE_ANON_KEY')
}

function serviceKey() {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY')
}

function resolveSourceSessionId() {
  if (process.env.E2E_SOURCE_SESSION_ID) return process.env.E2E_SOURCE_SESSION_ID
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'e2e/.auth/session-context.json'), 'utf8')
    const ctx = JSON.parse(raw) as { sessionId?: string | null }
    if (ctx.sessionId) return ctx.sessionId
  } catch {
    // use fallback
  }
  return SOURCE_SESSION_FALLBACK
}

async function signInHost() {
  const url = supabaseUrl()
  const key = anonKey()
  if (!url || !key) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL/ANON_KEY for E2E UI')
  const host = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { data, error } = await host.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error
  if (!data.user?.id) throw new Error('Host login returned no user')
  return { host, hostId: data.user.id }
}

async function createService() {
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for E2E UI')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
}

async function cloneSessionForTest(title: string): Promise<E2EContext> {
  const service = await createService()
  const { host, hostId } = await signInHost()
  const sourceSessionId = resolveSourceSessionId()
  const [{ data: sourceSession, error: sessionError }, { data: sourcePlayers, error: playersError }] = await Promise.all([
    service.from('sessions').select('*').eq('id', sourceSessionId).single(),
    service.from('session_players').select('*').eq('session_id', sourceSessionId),
  ])
  if (sessionError) throw sessionError
  if (playersError) throw playersError
  if (!sourcePlayers || sourcePlayers.length < 8) throw new Error(`Source session needs >=8 players, got ${sourcePlayers?.length ?? 0}`)

  const sessionId = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const playerRows = sourcePlayers.map((row: Record<string, unknown>) => ({
    ...row,
    session_id: sessionId,
    status: 'confirmed',
    check_in_status: 'present',
    created_at: nowIso,
    match_result: 'pending',
    proposed_result: 'pending',
    result_confirmation_status: 'not_submitted',
  }))
  const playerIds = playerRows.map(row => String(row.player_id))

  const { error: insertSessionError } = await service.from('sessions').insert({
    ...sourceSession,
    id: sessionId,
    host_id: hostId,
    slot_id: null,
    title: `E2E-UI-${Date.now()}-${title.slice(0, 24)}`,
    status: 'playing',
    created_at: nowIso,
    updated_at: nowIso,
    check_in_completed: true,
    live_state_version: 0,
    results_status: 'not_submitted',
    results_submitted_at: null,
    pending_completion_marked_at: null,
    auto_closed_at: null,
    finalized_by: null,
    elo_processed: false,
  })
  if (insertSessionError) throw insertSessionError

  const { error: insertPlayersError } = await service.from('session_players').insert(playerRows)
  if (insertPlayersError) throw insertPlayersError

  const { error: syncError } = await host.rpc('sync_live_session_roster_versioned', {
    p_session_id: sessionId,
    p_player_ids: playerIds,
    p_revive_checked_out: true,
  })
  if (syncError) throw syncError

  return { service, host, sessionId, playerIds }
}

async function cleanupSession(ctx?: E2EContext) {
  if (!ctx) return
  for (const table of [
    'session_live_matches',
    'session_pair_history',
    'session_player_state',
    'session_rounds',
    'suggester_decision_events',
    'session_next_round_settings',
    'board_stuck_events',
  ]) {
    await ctx.service.from(table).delete().eq('session_id', ctx.sessionId)
  }
  await ctx.service.from('session_players').delete().eq('session_id', ctx.sessionId)
  await ctx.service.from('sessions').delete().eq('id', ctx.sessionId)
}

async function gotoSession(page: Page, sessionId: string) {
  await page.goto(`/host/session/${sessionId}/next-round`)
  await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 25_000 })
}

async function waitForBoard(page: Page) {
  await expect(page.getByTestId('nrv2-court-lane-board').or(page.getByTestId('nrv2-live-match-board'))).toBeVisible({ timeout: 45_000 })
}

async function openOrRefreshBoard(page: Page, ctx: E2EContext) {
  await gotoSession(page, ctx.sessionId)
  const boardVisible = await page.getByTestId('nrv2-court-lane-board').isVisible({ timeout: 12_000 }).catch(() => false)
  if (!boardVisible) {
    const primary = page.getByTestId('nrv2-cta-primary')
    if (await primary.isVisible({ timeout: 8_000 }).catch(() => false)) await primary.click({ force: true })
  }
  await waitForBoard(page)
}

async function getVersion(ctx: E2EContext) {
  const { data, error } = await ctx.host.rpc('get_live_session_version_guard', { p_session_id: ctx.sessionId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return Number(row.live_state_version ?? 0)
}

async function liveRows(ctx: E2EContext) {
  const { data, error } = await ctx.service
    .from('session_live_matches')
    .select('*')
    .eq('session_id', ctx.sessionId)
    .neq('status', 'cancelled')
    .order('sequence_no', { ascending: true })
  if (error) throw error
  return (data ?? []) as LiveRow[]
}

async function startFirstSuggestedViaRpc(ctx: E2EContext, courtIdx?: number) {
  const suggested = (await liveRows(ctx)).find(row => row.status === 'suggested' && (courtIdx == null || row.court_idx === courtIdx))
  if (!suggested) throw new Error('No suggested match to start')
  const version = await getVersion(ctx)
  const { data, error } = await ctx.host.rpc('start_live_session_match_from_payload_versioned', {
    p_session_id: ctx.sessionId,
    p_expected_live_state_version: version,
    p_match: {
      court_idx: suggested.court_idx,
      team_a: suggested.team_a,
      team_b: suggested.team_b,
      resting: suggested.resting ?? [],
      round_no: suggested.round_no ?? 0,
    },
    p_audit_payload: {
      source: 'tests/e2e-ui/host-session.spec.ts',
      preview_live_state_version: version,
      preview_countable_match_count: (await liveRows(ctx)).filter(row => row.status !== 'cancelled').length,
    },
  })
  if (error) throw error
  return data?.match as LiveRow
}

async function completeLiveViaRpc(ctx: E2EContext, matchId: string) {
  const version = await getVersion(ctx)
  const { error } = await ctx.host.rpc('complete_live_session_match_versioned', {
    p_session_id: ctx.sessionId,
    p_expected_live_state_version: version,
    p_match_id: matchId,
    p_score_a: 11,
    p_score_b: 7,
    p_score_after: 0,
    p_audit_payload: { source: 'tests/e2e-ui/host-session.spec.ts' },
  })
  if (error) throw error
}

async function insertBoardRows(ctx: E2EContext, rows: Array<Partial<LiveRow> & Pick<LiveRow, 'team_a' | 'team_b' | 'status'>>) {
  const nowIso = new Date().toISOString()
  const inserts = rows.map((row, index) => ({
    session_id: ctx.sessionId,
    sequence_no: row.sequence_no ?? index,
    round_no: row.round_no ?? 0,
    court_idx: row.court_idx ?? index,
    status: row.status,
    team_a: row.team_a,
    team_b: row.team_b,
    resting: row.resting ?? [],
    score_a: row.score_a ?? 0,
    score_b: row.score_b ?? 0,
    suggested_at: nowIso,
    started_at: row.status === 'live' || row.status === 'completed' ? nowIso : null,
    ended_at: row.status === 'completed' ? nowIso : null,
  }))
  const { error } = await ctx.service.from('session_live_matches').insert(inserts)
  if (error) throw error
  await ctx.service.from('sessions').update({ live_state_version: (await getVersion(ctx)) + 1 }).eq('id', ctx.sessionId)
}

async function assertNoLongSpinner(page: Page) {
  const spinnerIds = [
    'nrv2-suggest-spinner',
    'nrv2-start-persisting-court-0',
    'nrv2-searching-next-court-0',
  ]
  for (const id of spinnerIds) {
    const spinner = page.getByTestId(id)
    if (await spinner.isVisible({ timeout: 500 }).catch(() => false)) {
      await expect(spinner).toBeHidden({ timeout: 10_000 })
    }
  }
}

let ctx: E2EContext | undefined

test.beforeEach(async ({}, testInfo) => {
  test.skip(!supabaseUrl() || !anonKey() || !serviceKey(), 'E2E UI needs Supabase URL, anon key, and service-role key')
  ctx = await cloneSessionForTest(testInfo.title)
})

test.afterEach(async ({ page }) => {
  if (ctx) {
    await assertNoLongSpinner(page).catch(() => undefined)
    const { data } = await ctx.service.from('board_stuck_events').select('kind,created_at').eq('session_id', ctx.sessionId).limit(20)
    if (data?.length) console.log(`[e2e-ui] board_stuck_events ${ctx.sessionId}: ${JSON.stringify(data)}`)
  }
  await cleanupSession(ctx)
  ctx = undefined
})

test.describe('host live board regressions', () => {
  test('S1 preserves a host tradeoff choice across board refresh', async ({ page }) => {
    await openOrRefreshBoard(page, ctx!)

    const tradeoffChoices = page.locator('[data-testid^="nrv2-tradeoff-choice-"]')
    const count = await tradeoffChoices.count()
    test.skip(count < 2, 'Seed did not produce multiple tradeoff choices')

    const nonRecommended = tradeoffChoices.nth(1)
    const selectedBefore = await nonRecommended.getAttribute('data-testid')
    await nonRecommended.click()

    const suggestedRows = (await liveRows(ctx!)).filter(row => row.status === 'suggested')
    test.skip(suggestedRows.length < 2, 'Need a second court to complete in the background')
    const started = await startFirstSuggestedViaRpc(ctx!, suggestedRows[1].court_idx ?? undefined)
    await completeLiveViaRpc(ctx!, started.id)

    await page.reload()
    await waitForBoard(page)
    await expect(page.locator(`[data-testid="${selectedBefore}"]`)).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 })
  })

  test('S2 latch spinner clears after generation changes during suggest', async ({ page }) => {
    await gotoSession(page, ctx!.sessionId)
    const primary = page.getByTestId('nrv2-cta-primary')
    if (await primary.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await Promise.all([
        primary.click({ force: true }),
        page.waitForTimeout(300),
      ])
    }
    await insertBoardRows(ctx!, [{
      status: 'completed',
      sequence_no: 99,
      round_no: 0,
      court_idx: 99,
      team_a: ctx!.playerIds.slice(0, 2),
      team_b: ctx!.playerIds.slice(2, 4),
    }])
    await expect(page.getByTestId('nrv2-suggest-spinner')).toBeHidden({ timeout: 8_000 })
    await waitForBoard(page)
  })

  test('S3 tiers warnings: warnings stay visible and info is collapsed by default', async ({ page }) => {
    await openOrRefreshBoard(page, ctx!)
    const warningList = page.locator('[data-testid^="nrv2-warning-list-court-"]').first()
    const hasWarnings = await warningList.isVisible({ timeout: 8_000 }).catch(() => false)
    test.skip(!hasWarnings, 'Seed did not produce warning/info rows')

    const infoToggle = page.locator('[data-testid$="-info-toggle"]').first()
    if (await infoToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(page.locator('[data-testid*="-severity-info-"]').first()).toBeHidden()
      await infoToggle.click()
      await expect(page.locator('[data-testid*="-severity-info-"]').first()).toBeVisible()
    }
    await expect(page.locator('[data-testid*="-severity-warning-"]').first()).toBeVisible()
  })

  test('S4 rest-risk banner opens swap sheet with the risk player action', async ({ page }) => {
    const riskPlayerId = ctx!.playerIds[0]
    await ctx!.service
      .from('session_player_state')
      .update({ consecutive_rest: 1, consecutive_play: 0 })
      .eq('session_id', ctx!.sessionId)
      .eq('player_id', riskPlayerId)
    await openOrRefreshBoard(page, ctx!)

    const banner = page.getByTestId('nrv2-rest-risk-banner')
    test.skip(!(await banner.isVisible({ timeout: 8_000 }).catch(() => false)), 'Rest-risk banner did not appear for this seed')
    await page.getByTestId(`nrv2-rest-risk-swap-${riskPlayerId}`).click()
    await expect(page.getByTestId('nrv2-swap-sheet')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByTestId(`nrv2-swap-from-${riskPlayerId}`)).toHaveAttribute('aria-selected', 'true')
  })

  test('S5 settings do not reset when court count changes mid-session', async ({ page }) => {
    await openOrRefreshBoard(page, ctx!)
    await page.getByTestId('nrv2-settings-chip').click()
    await expect(page.getByTestId('nrv2-settings-sheet')).toBeVisible()
    const pvnaOption = page.getByTestId('nrv2-settings-pvna-tolerance-option-0.75')
    const targetOption = page.getByTestId('nrv2-settings-target-rounds-option-10')
    test.skip(!(await pvnaOption.isVisible().catch(() => false)) || !(await targetOption.isVisible().catch(() => false)), 'Expected settings options not present')
    await pvnaOption.click()
    await targetOption.click()
    await page.keyboard.press('Escape')

    await ctx!.service.from('sessions').update({ live_state_version: (await getVersion(ctx!)) + 1 }).eq('id', ctx!.sessionId)
    await page.reload()
    await page.getByTestId('nrv2-settings-chip').click()
    await expect(page.getByTestId('nrv2-settings-pvna-tolerance-option-0.75')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('nrv2-settings-target-rounds-option-10')).toHaveAttribute('aria-selected', 'true')
  })

  test('S6 round display uses DB round_no for short rounds', async ({ page }) => {
    await insertBoardRows(ctx!, [
      { status: 'completed', sequence_no: 0, round_no: 0, court_idx: 0, team_a: ctx!.playerIds.slice(0, 2), team_b: ctx!.playerIds.slice(2, 4) },
      { status: 'completed', sequence_no: 1, round_no: 0, court_idx: 1, team_a: ctx!.playerIds.slice(4, 6), team_b: ctx!.playerIds.slice(6, 8) },
      { status: 'suggested', sequence_no: 2, round_no: 1, court_idx: 0, team_a: ctx!.playerIds.slice(0, 2), team_b: ctx!.playerIds.slice(4, 6) },
    ])
    await gotoSession(page, ctx!.sessionId)
    await waitForBoard(page)
    await expect(page.getByTestId('nrv2-court-lane-0-round')).toContainText(/Round 2\b/)
  })

  test('S7 double-tap start creates exactly one live match for the court', async ({ page }) => {
    await openOrRefreshBoard(page, ctx!)
    const start = page.getByTestId('nrv2-start-match-court-0')
    await expect(start).toBeVisible({ timeout: 15_000 })
    await Promise.all([
      start.click({ force: true }),
      start.click({ force: true }).catch(() => undefined),
    ])
    await expect(page.getByTestId('nrv2-live-card-court-0')).toBeVisible({ timeout: 20_000 })
    const rows = (await liveRows(ctx!)).filter(row => row.court_idx === 0 && row.status === 'live')
    expect(rows).toHaveLength(1)
  })

  test('S8 does not leave a spinner stuck when a court has enough players', async ({ page }) => {
    await openOrRefreshBoard(page, ctx!)
    await assertNoLongSpinner(page)
    const availableCount = ctx!.playerIds.length - (await liveRows(ctx!)).filter(row => row.status === 'live').flatMap(row => [...row.team_a, ...row.team_b]).length
    expect(availableCount).toBeGreaterThanOrEqual(4)
  })
})
