import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:1421',
    viewport: { width: 1240, height: 800 },
  },
  webServer: {
    command: 'npm run dev -- --port 1421',
    url: 'http://localhost:1421',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
