import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
/** A second build with the AI scanner switched on (its API is mocked in the tests). */
export const SCAN_PORT = 4175;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    // iPhone-sized viewport with touch, run in Chromium.
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx vite build --mode scantest --outDir dist-scan-test && npx vite preview --outDir dist-scan-test --port ${SCAN_PORT} --strictPort`,
      port: SCAN_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
