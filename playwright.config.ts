import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 4173)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: `npx expo export --platform web --output-dir web-build && node ./scripts/serve-web-build.mjs ${PORT}`,
    env: {
      ...process.env,
      CI: '1',
      EXPO_PUBLIC_E2E: '1',
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: /.*\.auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chrome',
      testIgnore: /.*\.auth\.setup\.ts/,
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-safari',
      testIgnore: /.*\.auth\.setup\.ts/,
      use: { ...devices['iPhone 14'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'storage-blocked-simulation',
      use: { 
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/host.json',
      },
      dependencies: ['setup'],
    },
  ],
})
