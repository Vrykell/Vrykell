import { expect, test } from '@playwright/test';
import { setupTauriMock, mockAnthropic, paceLlmStream } from './tauri-mock';

const answer = String.raw`Wave equation

$$\nabla^2\mathbf{E}-\frac{1}{c^2}\frac{\partial^2\mathbf{E}}{\partial t^2}=0,\qquad c=\frac{1}{\sqrt{\varepsilon_0\mu_0}}$$

Tall expressions

$$
\begin{pmatrix}\frac{\sum_{i=1}^{n}x_i^2}{\sqrt{1+\frac{a}{b}}} & \displaystyle\int_{-\infty}^{\infty}e^{-x^2}\,dx \\ \frac{\partial^2 f}{\partial t^2} & \sqrt{\frac{a^2+b^2}{c^2+d^2}}\end{pmatrix}
$$

Wide expression

$$\underbrace{a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}+a_{16}}_{\text{All terms remain reachable}}=\sum_{i=1}^{16}a_i$$

Inline $x^2+\frac{a}{b}$ stays within the paragraph.`;

for (const scale of [1, 1.25, 1.5]) {
  test(`display math retains tall glyphs and both ends of wide formulas at ${scale} display scale`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    try {
      const failedFonts: string[] = [];
      page.on('requestfailed', request => { if (/KaTeX_.*\.(woff2?|ttf)/.test(request.url())) failedFonts.push(request.url()); });
      await mockAnthropic(page, answer);
      await setupTauriMock(page, { schedulesSeed: [] });
      await paceLlmStream(page, 5);
      await page.goto('/');
      await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
      await page.getByRole('button', { name: '询问 AI', exact: true }).click();
      const input = page.getByPlaceholder(/自然语言描述/);
      await page.waitForFunction(async () => {
        const { useChatStore } = await import('/src/features/chat/stores/chat.ts') as typeof import('../src/features/chat/stores/chat');
        const state = useChatStore.getState();
        return !!state.activeConversationId && state.activeConversationId in state.byTab;
      });
      await input.fill('Show mathematical expressions');
      await input.press('Enter');
      const formulas = page.getByRole('region', { name: '数学公式' });
      await expect(page.getByText('Wave equation', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.chat-send-button')).toHaveAttribute('aria-label', '发送', { timeout: 10000 });
      await expect(formulas).toHaveCount(3);
      await expect(input).toBeEnabled();
      await page.evaluate(async () => { await document.fonts.ready; });
      expect(failedFonts).toEqual([]);
      expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main') && document.fonts.check('italic 16px KaTeX_Math'))).toBe(true);
      for (const width of [1240, 680]) {
        await page.setViewportSize({ width, height: 900 });
        for (const formula of await formulas.all()) {
          await formula.scrollIntoViewIfNeeded();
          await formula.evaluate(element => { element.scrollLeft = 0; });
          await expect(formula.locator('.base').first()).toHaveCSS('display', 'inline-block');
          const bounds = await formula.evaluate(element => {
            const outer = element.getBoundingClientRect();
            const inner = element.querySelector('.katex-display')!.getBoundingClientRect();
            const glyphs = [...element.querySelectorAll<HTMLElement>('.katex-html .mord, .katex-html .mop, .katex-html .frac-line, .katex-html .sqrt svg')]
              .map(glyph => glyph.getBoundingClientRect()).filter(rect => rect.height > 0);
            return { topSpace: Math.min(inner.top, ...glyphs.map(rect => rect.top)) - outer.top,
              bottomSpace: outer.bottom - Math.max(inner.bottom, ...glyphs.map(rect => rect.bottom)),
              leftSpace: inner.left - outer.left, heightOverflow: element.scrollHeight - element.clientHeight,
              fontSize: parseFloat(getComputedStyle(element.querySelector('.katex')!).fontSize) };
          });
          expect(bounds.topSpace).toBeGreaterThanOrEqual(1);
          expect(bounds.bottomSpace).toBeGreaterThanOrEqual(1);
          expect(bounds.leftSpace).toBeGreaterThanOrEqual(0);
          expect(bounds.heightOverflow).toBeLessThanOrEqual(1);
          expect(bounds.fontSize).toBeGreaterThanOrEqual(16);
        }
        const wide = formulas.last();
        expect(await wide.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await wide.focus();
        await page.keyboard.press('End');
        await wide.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        expect(await wide.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        const rightInset = await wide.evaluate(element => element.getBoundingClientRect().right - element.querySelector('.katex-display')!.getBoundingClientRect().right);
        expect(rightInset).toBeGreaterThanOrEqual(0);
        await formulas.first().scrollIntoViewIfNeeded();
        await wide.evaluate(element => { element.scrollLeft = 0; });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: testInfo.outputPath(`math-${scale}-${width}.png`) });
      }
    } finally { await context.close(); }
  });
}
