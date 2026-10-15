import { defineConfig } from '@playwright/test';

// The suite runs against a local dev server. A machine-wide npm proxy
// (`npm_config_proxy`, injected by npm/npx) is read by Playwright's web-server
// availability probe, so the loopback request is sent through the proxy and its
// error response is mistaken for "port already used". Keep loopback direct.
for (const key of ['no_proxy', 'NO_PROXY'] as const) {
  const current = process.env[key];
  process.env[key] = current ? `${current},127.0.0.1,localhost` : '127.0.0.1,localhost';
}

/**
 * Port for the suite's dev server. Parallel worktrees each set their own `PW_PORT` so no
 * run can shut down another run's server; the historical default stays 1421.
 */
function e2ePort(): number {
  const configured = Number(process.env.PW_PORT);
  return Number.isInteger(configured) && configured > 0 && configured < 65_536 ? configured : 1421;
}

const port = e2ePort();
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // PTY、Canvas 与窗口尺寸断言对并行资源竞争敏感，E2E 串行运行以保持确定性。
  workers: 1,
  use: {
    // Match the desktop browser: native scrollbars must be visible and draggable.
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    baseURL: origin,
    viewport: { width: 1240, height: 800 },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --host 127.0.0.1`,
    url: origin,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
