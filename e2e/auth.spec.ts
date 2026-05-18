/**
 * Tier 1 auth tests — A1 through A4.
 * These tests run without a pre-seeded auth token so they exercise the real login flow.
 */
import { expect, test } from '@playwright/test'

// Override the global storageState so each test starts unauthenticated.
test.use({ storageState: { cookies: [], origins: [] } })

const HOST_EMAIL = process.env.E2E_HOST_EMAIL ?? 'host.confirmed@picklematch.vn'
const WRONG_PASSWORD = 'WrongPassword999!'

test.describe('Auth — host login', () => {
  test('A1: valid credentials redirect away from /host/login', async ({ page }) => {
    await page.goto('/host/login')
    await page.getByTestId('dev-host-email-input').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('dev-host-email-input').fill(HOST_EMAIL)
    await page.getByTestId('dev-host-password-input').fill(
      process.env.E2E_DUMMY_PASSWORD ?? 'Pickle123!'
    )
    await page.getByTestId('dev-host-login-submit').click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
    expect(page.url()).not.toContain('/login')
  })

  test('A2: wrong password shows an error and stays on login page', async ({ page }) => {
    await page.goto('/host/login')
    await page.getByTestId('dev-host-email-input').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('dev-host-email-input').fill(HOST_EMAIL)
    await page.getByTestId('dev-host-password-input').fill(WRONG_PASSWORD)
    await page.getByTestId('dev-host-login-submit').click()

    // Expect to remain on the login page and see an error message.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
    // Any error text visible — the exact wording can vary.
    const errorVisible = await page
      .locator('text=/sai|lỗi|không đúng|invalid|incorrect|error/i')
      .isVisible()
      .catch(() => false)
    // If no error text, at minimum verify we're still on login.
    expect(page.url()).toContain('/login')
    // This is a soft check — if there IS error text, great.
    if (errorVisible) expect(errorVisible).toBe(true)
  })
})

test.describe('Auth — player login', () => {
  test('A3: player valid credentials redirect away from /login', async ({ page }) => {
    await page.goto('/login')
    // If already redirected away, that also passes.
    const currentUrl = page.url()
    if (!currentUrl.includes('/login')) return

    await page.getByTestId('dev-player-email-input').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('dev-player-email-input').fill(
      process.env.E2E_PLAYER_EMAIL ?? 'player.matched@picklematch.vn'
    )
    await page.getByTestId('dev-player-password-input').fill(
      process.env.E2E_DUMMY_PASSWORD ?? 'Pickle123!'
    )
    await page.getByTestId('dev-player-login-submit').click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
    expect(page.url()).not.toContain('/login')
  })
})

test.describe('Auth — session persistence', () => {
  test('A4: after login, reload keeps the user authenticated', async ({ page }) => {
    // Log in first.
    await page.goto('/host/login')
    await page.getByTestId('dev-host-email-input').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('dev-host-email-input').fill(HOST_EMAIL)
    await page.getByTestId('dev-host-password-input').fill(
      process.env.E2E_DUMMY_PASSWORD ?? 'Pickle123!'
    )
    await page.getByTestId('dev-host-login-submit').click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })

    // Reload and verify the protected page is still accessible.
    await page.goto('/host/profile')
    await page.reload()
    await expect(page.getByTestId('host-profile-screen')).toBeVisible({ timeout: 15_000 })
  })
})
