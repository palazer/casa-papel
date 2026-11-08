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
    // serves the e2e build (vite --mode e2e), which points sync at a fake server the tests intercept
    command: 'npm run preview:e2e',
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
