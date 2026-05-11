import { expect, test } from '@playwright/test'

const SESSION_IDS = {
  openConfirmed: '55555555-5555-5555-5555-555555555551',
  resultsPending: '55555555-5555-5555-5555-555555555558',
}

test.describe('PickleMatch web smoke', () => {
  test('host profile and session detail smoke path', async ({ page }) => {
    await page.goto('/host/profile')
    await expect(page).toHaveURL(/\/host\/profile/)
    await expect(page.getByText(/host/i).first()).toBeVisible()

    await page.goto(`/session/${SESSION_IDS.openConfirmed}`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.openConfirmed}`))
  })

  test('session detail loads and player can open confirm-result flow', async ({ page }) => {
    await page.goto(`/session/${SESSION_IDS.resultsPending}`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.resultsPending}`))

    await page.goto(`/session/${SESSION_IDS.resultsPending}/confirm-result`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.resultsPending}/confirm-result`))
  })

  test('storage blocked simulation shows warning banner', async ({ page }, testInfo) => {
    if (testInfo.project.name.includes('storage-blocked')) {
      await page.addInitScript(() => {
        // Mocking blocked storage by overriding setItem to throw
        const proto = Object.getPrototypeOf(window.localStorage)
        proto.setItem = function() { throw new Error('QuotaExceededError') }
      })
    }

    await page.goto('/host/profile')
    // Check for the warning banner we added to AuthGate
    if (testInfo.project.name.includes('storage-blocked')) {
      await expect(page.getByText(/Trình duyệt đang chặn lưu trữ/i)).toBeVisible()
    }
  })

  test('offline transition smoke', async ({ page }) => {
    await page.goto('/host/profile')
    await expect(page.getByText(/host/i).first()).toBeVisible()

    // Simulate going offline
    await page.context().setOffline(true)
    await page.reload()
    
    // Check if app still shows some UI or an offline message if implemented
    // For now, we just verify it doesn't crash to a white screen
    await expect(page.locator('body')).not.toBeEmpty()
    
    // Restore
    await page.context().setOffline(false)
    await page.reload()
    await expect(page.getByText(/host/i).first()).toBeVisible()
  })
})
