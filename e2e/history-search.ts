import type { Page } from '@playwright/test';

/** Open the compact history search when needed and fill its shared input. */
export async function fillHistorySearch(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  if (!await input.isVisible()) await page.getByTestId('history-search-toggle').first().click();
  await input.fill(value);
}
