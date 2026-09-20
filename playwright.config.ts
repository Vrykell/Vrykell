import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // PTY、Canvas 与窗口尺寸断言对并行资源竞争敏感，E2E 串行运行以保持确定性。
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:1421',
    viewport: { width: 1240, height: 800 },
  },
  webServer: {
    command: 'npm run dev -- --port 1421 --host 127.0.0.1',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
