import { expect, test } from '@playwright/test'

test.describe('In-App Browser Simulation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.project.name === 'in-app-browser-simulation') {
      // Force block storage for all IAB simulation tests
      await page.addInitScript(() => {
        // Block only writes to simulate private mode / quota full
        // while allowing reads so pre-loaded auth state works.
        const mockSetItem = () => { throw new Error('QuotaExceededError') };
        try {
          window.localStorage.setItem = mockSetItem;
          window.sessionStorage.setItem = mockSetItem;
        } catch (e) {
          // Some browsers might not allow overwriting directly
        }
      })
    }
  })

  test('IAB: should show persistence warning banner', async ({ page }) => {
    await page.goto('/host/dashboard')
    
    // The banner from AuthGate.tsx
    await expect(page.getByText(/Trình duyệt đang chặn lưu trữ/i)).toBeVisible()
  })

  test('IAB: should maintain session in memory despite blocked storage', async ({ page }) => {
    await page.goto('/host/dashboard')
    await expect(page.getByText(/host/i).first()).toBeVisible()

    // Navigate to profile using a more reliable selector or direct URL
    await page.goto('/host/profile')
    await expect(page).toHaveURL(/\/host\/profile/)
    
    // Session should still be valid because AuthGate/useAuth maintains it in memory
    await expect(page.getByText(/host/i).first()).toBeVisible()
  })

  test('IAB: input focus should not cause disruptive layout shifts', async ({ page }) => {
    // Go to profile which has inputs
    await page.goto('/host/profile')
    
    const input = page.locator('input').first()
    await input.focus()
    
    // Check if the input is still visible and not obscured by keyboard simulation
    // (Playwright doesn't perfectly simulate keyboard, but we check if viewport changes break things)
    await expect(input).toBeVisible()
    
    // Verify font size is at least 16px to prevent iOS auto-zoom
    const fontSize = await input.evaluate(el => window.getComputedStyle(el).fontSize)
    const fontSizeNum = parseFloat(fontSize)
    expect(fontSizeNum).toBeGreaterThanOrEqual(16)
  })
})
