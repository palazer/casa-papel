import { defineConfig, devices } from '@playwright/test'

const BASE = 'http://localhost:4173/casa-papel/'

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/output/results',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview',
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
