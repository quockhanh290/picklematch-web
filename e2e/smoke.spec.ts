import { expect, test } from '@playwright/test'

const SESSION_IDS = {
  openConfirmed: '55555555-5555-5555-5555-555555555551',
  resultsPending: '55555555-5555-5555-5555-555555555558',
}

test.describe('PickleMatch web smoke', () => {
  test('host profile and session detail smoke path', async ({ page }) => {
    await page.goto('/owner/profile')
    await expect(page).toHaveURL(/\/owner\/profile/)
    await expect(page.getByText(/chủ sân/i).first()).toBeVisible()

    await page.goto(`/session/${SESSION_IDS.openConfirmed}`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.openConfirmed}`))
  })

  test('session detail loads and player can open confirm-result flow', async ({ page }) => {
    await page.goto(`/session/${SESSION_IDS.resultsPending}`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.resultsPending}`))

    await page.goto(`/session/${SESSION_IDS.resultsPending}/confirm-result`)
    await expect(page).toHaveURL(new RegExp(`/session/${SESSION_IDS.resultsPending}/confirm-result`))
  })
})
