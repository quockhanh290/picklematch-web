import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 4173)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`
const useLocalWebServer = !process.env.E2E_BASE_URL

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'e2e/setup/*.setup.ts', 'tests/e2e-ui/**/*.spec.ts'],
  timeout: 60_000,
  workers: 1,
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
  webServer: useLocalWebServer
    ? {
      command: `npx expo export --platform web --output-dir web-build && node ./scripts/serve-web-build.mjs ${PORT}`,
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_E2E: '1',
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 180_000,
    }
    : undefined,
  projects: [
    {
      name: 'setup',
      testMatch: /host\.auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'player-setup',
      testMatch: /player\.auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: [/.*\.auth\.setup\.ts/, /player-critical\.spec\.ts/, /next-round\.spec\.ts/, /tests\/e2e-ui\//],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'next-round-chromium',
      testMatch: /next-round\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'e2e-ui-chromium',
      testMatch: /tests\/e2e-ui\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'player-chromium',
      testMatch: /player-critical\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/player.json' },
      dependencies: ['player-setup'],
    },
    {
      name: 'mobile-chrome',
      testIgnore: [/.*\.auth\.setup\.ts/, /player-critical\.spec\.ts/, /next-round\.spec\.ts/, /tests\/e2e-ui\//],
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-safari',
      testIgnore: [/.*\.auth\.setup\.ts/, /player-critical\.spec\.ts/, /next-round\.spec\.ts/, /tests\/e2e-ui\//],
      use: { ...devices['iPhone 14'], storageState: 'e2e/.auth/host.json' },
      dependencies: ['setup'],
    },
    {
      name: 'storage-blocked-simulation',
      testIgnore: [/player-critical\.spec\.ts/, /next-round\.spec\.ts/, /tests\/e2e-ui\//],
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/host.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'in-app-browser-simulation',
      testIgnore: [/tests\/e2e-ui\//],
      use: {
        ...devices['iPhone 14'],
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/23.05.01',
        viewport: { width: 390, height: 664 }, // Reduced height for in-app headers/footers
        storageState: 'e2e/.auth/host.json',
      },
      dependencies: ['setup'],
    },
  ],
})
