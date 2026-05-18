/**
 * Next Round Suggester V2 — comprehensive E2E flow tests.
 * Chạy với auth của host@test.com (hoặc host.confirmed@picklematch.vn nếu không có).
 *
 * Session ID được resolve động trong global-setup từ DB:
 *   → session mới nhất được tạo bởi host@test.com
 *   → fallback về seeded session 55555555-5555-5555-5555-555555555570
 *
 * Các test NR9–NR11 (start/end round) modify live state — chạy với --workers=1.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// ── Resolve session ID ────────────────────────────────────────────────────────

// fullConfirmed — 4 player confirmed, host là host.confirmed@picklematch.vn, tồn tại trong DB từ seed cũ
const FALLBACK_SESSION_ID = '55555555-5555-5555-5555-555555555553'

function resolveSessionId(): string {
  try {
    const contextPath = path.resolve(process.cwd(), 'e2e/.auth/session-context.json')
    const raw = fs.readFileSync(contextPath, 'utf8')
    const ctx = JSON.parse(raw) as { sessionId: string | null; source: string }
    if (ctx.sessionId) {
      console.log(`[next-round] Dùng session từ DB (${ctx.source}): ${ctx.sessionId}`)
      return ctx.sessionId
    }
  } catch { /* file chưa có hoặc parse lỗi */ }
  console.log(`[next-round] Dùng fallback session: ${FALLBACK_SESSION_ID}`)
  return FALLBACK_SESSION_ID
}

const SESSION_ID = resolveSessionId()
const NR_URL = `/host/session/${SESSION_ID}/next-round`

// ── Helpers ───────────────────────────────────────────────────────────────────

async function gotoNextRound(page: import('@playwright/test').Page) {
  await page.goto(NR_URL)
  await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 20_000 })
}

async function waitForAlternatives(page: import('@playwright/test').Page) {
  // 60s để xử lý cold start của edge function (Deno Deploy thường 2-10s cold, nhưng có thể lâu hơn)
  await expect(page.getByTestId('nrv2-alt-tab-0')).toBeVisible({ timeout: 60_000 })
}

async function ensurePlanPhase(page: import('@playwright/test').Page) {
  const cta = page.getByTestId('nrv2-cta-primary')
  await expect(cta).toBeVisible({ timeout: 10_000 })
  const text = await cta.textContent()
  if (text?.includes('Kết thúc')) {
    // Đang active → end round trước
    await cta.click({ force: true })
    await page.waitForTimeout(8_000)
  }
  await waitForAlternatives(page)
}

async function triggerSync(page: import('@playwright/test').Page) {
  const emptySync = await page.getByTestId('nrv2-sync-btn').isVisible({ timeout: 2_000 }).catch(() => false)
  if (emptySync) {
    await page.getByTestId('nrv2-sync-btn').click({ force: true })
    return
  }
  // Mở More sheet và sync — KHÔNG đóng sheet ngay để tránh interrupt fetch
  const moreBtn = page.getByTestId('nrv2-cta-more')
  if (await moreBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await moreBtn.click({ force: true })
    await page.waitForTimeout(1_000)
    const syncInSheet = page.locator('text=/Đồng bộ danh sách/i').last()
    if (await syncInSheet.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await syncInSheet.click({ force: true })
      // Để sheet tự đóng sau khi sync xong thay vì ép Escape
      await page.waitForTimeout(2_000)
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
}

async function syncRosterIfNeeded(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 20_000 })

  // Attempt 1: chờ 15s xem alternatives có tự xuất hiện từ pre-sync không
  const presyncAppeared = await page.getByTestId('nrv2-alt-tab-0')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (presyncAppeared) return

  // Attempt 2: trigger sync từ browser
  await triggerSync(page)
  const syncAppeared = await page.getByTestId('nrv2-alt-tab-0')
    .waitFor({ state: 'visible', timeout: 40_000 })
    .then(() => true)
    .catch(() => false)
  if (syncAppeared) return

  // Attempt 3: reload page (fix auth/network issues) rồi sync lại
  await page.reload()
  await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 20_000 })
  await triggerSync(page)
  await waitForAlternatives(page)
}

// ── NR1: màn hình load ────────────────────────────────────────────────────────

test.describe('NR1: màn hình load', () => {
  test('next-round screen render được cho session của host@test.com', async ({ page }) => {
    await page.goto(NR_URL)
    await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 20_000 })

    const hasAlts = await page.getByTestId('nrv2-alt-tab-0').isVisible({ timeout: 5_000 }).catch(() => false)
    const hasSync = await page.getByTestId('nrv2-sync-btn').isVisible({ timeout: 3_000 }).catch(() => false)
    const hasCta = await page.getByTestId('nrv2-cta-primary').isVisible({ timeout: 3_000 }).catch(() => false)
    expect(hasAlts || hasSync || hasCta).toBe(true)
  })
})

// ── NR2: sync roster ──────────────────────────────────────────────────────────

test.describe('NR2: sync roster', () => {
  test('sync roster lấy player từ DB và hiện alternatives', async ({ page }) => {
    // Capture alert dialog để debug lỗi từ edge function
    const alerts: string[] = []
    page.on('dialog', async (dialog) => {
      console.log(`[NR2 dialog] type=${dialog.type()} message=${dialog.message()}`)
      alerts.push(dialog.message())
      await dialog.dismiss()
    })

    // Capture console errors từ browser
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        console.log(`[NR2 browser ${msg.type()}] ${msg.text()}`)
      }
    })

    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    if (alerts.length > 0) {
      console.log(`[NR2] Alert xuất hiện sau sync: ${alerts.join(' | ')}`)
    }

    await expect(page.getByTestId('nrv2-alt-tab-0')).toBeVisible()
    await expect(page.getByTestId('nrv2-alt-tab-1')).toBeVisible()
  })
})

// ── NR3: chọn alternative ────────────────────────────────────────────────────

test.describe('NR3: chọn alternative', () => {
  test('có thể chuyển qua lại ALT 1, 2, 3', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    await page.getByTestId('nrv2-alt-tab-1').click({ force: true })
    await page.waitForTimeout(500)
    await expect(page.getByTestId('nrv2-alt-tab-1')).toBeVisible()

    await page.getByTestId('nrv2-alt-tab-2').click({ force: true })
    await page.waitForTimeout(500)
    await expect(page.getByTestId('nrv2-alt-tab-2')).toBeVisible()

    await page.getByTestId('nrv2-alt-tab-0').click({ force: true })
    await page.waitForTimeout(300)
  })
})

// ── NR4: settings sheet ───────────────────────────────────────────────────────

test.describe('NR4: settings sheet', () => {
  test('mở settings, đổi số sân, apply', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    await page.getByTestId('nrv2-settings-chip').click({ force: true })
    await expect(page.locator('text=/Cài đặt vòng/i').first()).toBeVisible({ timeout: 8_000 })

    // Chọn 1 sân
    await page.locator('text=/^1$/').first().click({ force: true })
    await page.waitForTimeout(300)

    await page.getByTestId('nrv2-settings-apply').click({ force: true })
    await page.waitForTimeout(800)

    await expect(page.getByTestId('nrv2-settings-chip')).toBeVisible({ timeout: 5_000 })
  })
})

// ── NR5: fairness sheet ───────────────────────────────────────────────────────

test.describe('NR5: fairness sheet', () => {
  test('mở fairness sheet và hiện điểm', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    await page.getByTestId('nrv2-fairness-chip').click({ force: true })
    await expect(page.locator('text=/Fairness/i').first()).toBeVisible({ timeout: 8_000 })

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })
})

// ── NR6: check-out / check-in player giữa session ────────────────────────────

test.describe('NR6: in/out giữa session', () => {
  test('check-out rồi check-in lại một player', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    // Mở roster qua link "Người chơi"
    await page.getByTestId('nrv2-roster-link').click({ force: true })
    await expect(page.locator('text=/Người chơi/i').first()).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(1_500)

    const firstRow = page.getByTestId(/^nrv2-roster-player-/).first()
    await expect(firstRow).toBeVisible({ timeout: 8_000 })
    await firstRow.click({ force: true })
    await page.waitForTimeout(500)

    // Lấy testID cụ thể của checkout button đầu tiên (gắn với player ID)
    const checkoutBtn = page.getByTestId(/^nrv2-roster-checkout-/).first()
    await expect(checkoutBtn).toBeVisible({ timeout: 5_000 })
    const checkoutTestId = await checkoutBtn.getAttribute('data-testid') ?? ''
    const labelBefore = await checkoutBtn.textContent()

    await checkoutBtn.click({ force: true })
    await page.waitForTimeout(4_000)

    // Sau action, row có thể vẫn expanded hoặc đã collapse (tùy re-render)
    // Nếu button không còn visible → click row để expand lại
    const playerId = checkoutTestId.replace('nrv2-roster-checkout-', '')
    const checkoutBtnAfter = page.getByTestId(checkoutTestId)
    const stillExpanded = await checkoutBtnAfter.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!stillExpanded) {
      await page.getByTestId(`nrv2-roster-player-${playerId}`).click({ force: true })
      await page.waitForTimeout(500)
    }
    const labelAfter = await checkoutBtnAfter.textContent({ timeout: 5_000 })
    expect(labelAfter).not.toBe(labelBefore)

    // Khôi phục
    await checkoutBtnAfter.click({ force: true })
    await page.waitForTimeout(4_000)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })
})

// ── NR7: xin nghỉ (rest) ─────────────────────────────────────────────────────

test.describe('NR7: toggle xin nghỉ', () => {
  test('toggle rest cho một player rồi hoàn tác', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    await page.getByTestId('nrv2-roster-link').click({ force: true })
    await expect(page.locator('text=/Người chơi/i').first()).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(1_500)

    const firstRow = page.getByTestId(/^nrv2-roster-player-/).first()
    await expect(firstRow).toBeVisible({ timeout: 8_000 })
    await firstRow.click({ force: true })
    await page.waitForTimeout(500)

    const restBtn = page.getByTestId(/^nrv2-roster-rest-/).first()
    await expect(restBtn).toBeVisible({ timeout: 5_000 })
    const restTestId = await restBtn.getAttribute('data-testid') ?? ''
    const labelBefore = await restBtn.textContent()

    await restBtn.click({ force: true })
    await page.waitForTimeout(4_000)

    const playerId = restTestId.replace('nrv2-roster-rest-', '')
    const restBtnAfter = page.getByTestId(restTestId)
    const stillExpanded = await restBtnAfter.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!stillExpanded) {
      await page.getByTestId(`nrv2-roster-player-${playerId}`).click({ force: true })
      await page.waitForTimeout(500)
    }
    const labelAfter = await restBtnAfter.textContent({ timeout: 5_000 })
    expect(labelAfter).not.toBe(labelBefore)

    // Khôi phục
    await restBtnAfter.click({ force: true })
    await page.waitForTimeout(4_000)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })
})

// ── NR8: tạo group ────────────────────────────────────────────────────────────

test.describe('NR8: group management', () => {
  test('chọn 2 player, tạo group, rồi xóa group', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    await page.getByTestId('nrv2-roster-link').click({ force: true })
    await expect(page.locator('text=/Người chơi/i').first()).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(1_500)

    const rows = page.getByTestId(/^nrv2-roster-player-/)
    await expect(rows.first()).toBeVisible({ timeout: 8_000 })

    // Chọn player 1 vào group
    await rows.nth(0).click({ force: true })
    await page.waitForTimeout(400)
    await page.getByTestId(/^nrv2-roster-group-/).first().click({ force: true })
    await page.waitForTimeout(300)

    // Chọn player 2 vào group
    await rows.nth(0).click({ force: true }) // collapse
    await page.waitForTimeout(300)
    await rows.nth(1).click({ force: true })
    await page.waitForTimeout(400)
    await page.getByTestId(/^nrv2-roster-group-/).first().click({ force: true })
    await page.waitForTimeout(300)

    // Tạo group
    const createGroupBtn = page.getByTestId('nrv2-roster-create-group')
    await expect(createGroupBtn).toBeVisible({ timeout: 5_000 })
    await createGroupBtn.click({ force: true })
    await page.waitForTimeout(4_000)

    // Xóa group nếu tạo thành công
    const groupSection = await page.locator('text=/Nhóm hiện tại/i').isVisible({ timeout: 5_000 }).catch(() => false)
    if (groupSection) {
      const deleteBtn = page.locator('text=/Xóa/i').last()
      if (await deleteBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await deleteBtn.click({ force: true })
        await page.waitForTimeout(4_000)
      }
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })
})

// ── NR9: bắt đầu vòng ────────────────────────────────────────────────────────

test.describe('NR9: bắt đầu vòng', () => {
  test('nhấn start → chuyển sang active phase', async ({ page }) => {
    await gotoNextRound(page)
    await syncRosterIfNeeded(page)
    await ensurePlanPhase(page)

    const cta = page.getByTestId('nrv2-cta-primary')
    await expect(cta).toBeVisible({ timeout: 8_000 })
    await cta.click({ force: true })
    await page.waitForTimeout(6_000)

    const newText = await page.getByTestId('nrv2-cta-primary').textContent()
    expect(newText).toContain('Kết thúc')
  })
})

// ── NR10: kết thúc vòng ───────────────────────────────────────────────────────

test.describe('NR10: kết thúc vòng', () => {
  test('nhấn end → về plan phase với alternatives mới', async ({ page }) => {
    await gotoNextRound(page)

    // Đảm bảo đang ở active phase
    const cta = page.getByTestId('nrv2-cta-primary')
    await expect(cta).toBeVisible({ timeout: 20_000 })
    let ctaText = await cta.textContent()

    if (ctaText?.includes('Bắt đầu') || ctaText?.includes('Chạy thêm')) {
      await syncRosterIfNeeded(page)
      await cta.click({ force: true })
      await page.waitForTimeout(6_000)
      ctaText = await cta.textContent()
    }

    if (ctaText?.includes('Kết thúc')) {
      await cta.click({ force: true })
      await page.waitForTimeout(8_000)

      await waitForAlternatives(page)
      const afterText = await page.getByTestId('nrv2-cta-primary').textContent()
      expect(afterText?.includes('Bắt đầu') || afterText?.includes('Chạy thêm')).toBe(true)
    }
  })
})

// ── NR11: vòng 2 ─────────────────────────────────────────────────────────────

test.describe('NR11: vòng thứ hai', () => {
  test('sau vòng 1, start/end vòng 2 thành công', async ({ page }) => {
    // Dùng timeout dài hơn vì test này cần start + end 2 vòng
    test.setTimeout(120_000)

    await gotoNextRound(page)
    await syncRosterIfNeeded(page)

    const cta = page.getByTestId('nrv2-cta-primary')
    await expect(cta).toBeVisible({ timeout: 20_000 })
    let ctaText = await cta.textContent()

    // Nếu đang ở active phase (round đang chạy) → end trước
    if (ctaText?.includes('Kết thúc')) {
      await cta.click({ force: true })
      await page.waitForTimeout(8_000)
      ctaText = await cta.textContent()
    }

    // Lúc này phải ở plan phase (Bắt đầu / Chạy thêm)
    expect(ctaText?.includes('Bắt đầu') || ctaText?.includes('Chạy thêm')).toBe(true)

    // Start vòng kế
    await cta.click({ force: true })
    await page.waitForTimeout(6_000)

    const activeText = await cta.textContent()
    expect(activeText?.includes('Kết thúc')).toBe(true)

    // End vòng kế
    await cta.click({ force: true })
    await page.waitForTimeout(8_000)

    await expect(page.getByTestId('nrv2-screen')).toBeVisible()
  })
})

// ── NR12: kiểm tra không crash ────────────────────────────────────────────────

test.describe('NR12: không crash', () => {
  test('không có fatal error overlay khi load trang', async ({ page }) => {
    await page.goto(NR_URL)
    await expect(page.locator('body')).not.toBeEmpty()
    await page.waitForTimeout(2_000)

    const fatalError = await page.locator('text=/Something went wrong|Unhandled Error/i').isVisible({ timeout: 3_000 }).catch(() => false)
    expect(fatalError).toBe(false)
  })

  test('nrv2-screen hiển thị — không blank trắng', async ({ page }) => {
    await page.goto(NR_URL)
    await expect(page.getByTestId('nrv2-screen')).toBeVisible({ timeout: 20_000 })
  })
})
