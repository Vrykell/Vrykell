import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
  app: { security: { csp: string } };
};

test('production policy permits bundled scripts and blocks inline scripts and external requests', async ({ page }) => {
  await page.route('**/csp-allowed.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: "document.body.dataset.bundledRan = 'yes';",
  }));
  await page.route('**/csp-check', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': config.app.security.csp },
    body: '<!doctype html><html><body><script>document.body.dataset.inlineRan = "yes"</script><script src="/csp-allowed.js"></script></body></html>',
  }));
  await page.goto('/csp-check');
  await expect(page.locator('body')).toHaveAttribute('data-bundled-ran', 'yes');
  expect(await page.locator('body').getAttribute('data-inline-ran')).toBeNull();

  const violations = await page.evaluate(async () => {
    const blocked: string[] = [];
    const onViolation = (event: SecurityPolicyViolationEvent) => blocked.push(event.blockedURI);
    document.addEventListener('securitypolicyviolation', onViolation);
    try {
      await fetch('https://example.invalid/private').catch(() => undefined);
      await new Promise<void>(resolve => {
        try {
          const socket = new WebSocket('ws://localhost:1420');
          socket.onerror = () => resolve();
          socket.onopen = () => { socket.close(); resolve(); };
        } catch { resolve(); }
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      return blocked;
    } finally {
      document.removeEventListener('securitypolicyviolation', onViolation);
    }
  });
  expect(violations).toContain('https://example.invalid/private');
  expect(violations).toContain('ws://localhost:1420/');
});
