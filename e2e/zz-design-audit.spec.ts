// Throwaway design audit harness, not part of the suite. Delete after review.
import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const OUT = process.env.AUDIT_OUT ?? 'test-results/audit';

/** Palette experiment injected after theme application. */
const DARK: Record<string, string> = {
  '--canvas': '#1A1D24',
  '--sidebar-bg': '#20242C',
  '--chrome-bg': '#20242C',
  '--auxiliary-bg': '#20242C',
  '--surface': '#242933',
  '--card-bg': '#2B313D',
  '--elevated': '#323A48',
  '--field-bg': '#373F4E',
  '--composer-bg': '#373F4E',
  '--chrome-field': '#2B313D',
  '--hover': 'rgba(155,190,255,0.08)',
  '--button-hover': '#424B5C',
  '--selection-bg': '#3D4556',
  '--border': '#3A4252',
  '--border-strong': '#4E586C',
  '--resize-divider': 'rgba(155,190,255,0.06)',
  '--text-primary': '#E8ECF4',
  '--text-secondary': '#B7C1D4',
  '--text-muted': '#8E9BB0',
  '--icon-color': '#9BA8BE',
  '--segmented-track': '#2E3542',
  '--segmented-thumb': '#4A556B',
  '--tab-menu-bg': '#1A1D24',
  '--accent-bg': 'rgba(155,190,255,0.07)',
  '--accent-bg-strong': '#2E3646',
};

const LIGHT: Record<string, string> = {
  '--canvas': '#F7F8FA',
  '--sidebar-bg': '#E4E9F1',
  '--chrome-bg': '#E4E9F1',
  '--auxiliary-bg': '#E9EDF4',
  '--surface': '#EEF1F6',
  '--card-bg': '#E3E8F0',
  '--elevated': '#FFFFFF',
  '--field-bg': '#FFFFFF',
  '--composer-bg': '#FFFFFF',
  '--chrome-field': '#F4F6F9',
  '--hover': 'rgba(30,60,120,0.06)',
  '--button-hover': '#D5DCE7',
  '--selection-bg': '#D2D9E4',
  '--border': '#CDD5E1',
  '--border-strong': '#A7B3C4',
  '--text-primary': '#1C2430',
  '--text-secondary': '#4A5568',
  '--text-muted': '#667384',
  '--icon-color': '#4A5568',
  '--segmented-track': '#D5DCE6',
  '--segmented-thumb': '#FFFFFF',
  '--accent-bg': 'rgba(30,60,120,0.06)',
  '--accent-bg-strong': '#D5DCE6',
};

test.describe.configure({ mode: 'serial' });

for (const theme of ['dark', 'light'] as const) {
  test(`audit ${theme} 1440`, async ({ page }) => {
    await setupTauriMock(page, { groupedHistoricalSession: true, sshWorkspaceView: 'dashboard' });
    await page.addInitScript((theme) => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.evaluate(
      async (vars) => {
        const { useTerminalThemeStore } = await import('/src/features/settings/model/terminalTheme.ts');
        await useTerminalThemeStore.getState().update({ desktopTint: false });
        const apply = () => {
          for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
        };
        apply();
        new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      },
      theme === 'dark' ? DARK : LIGHT,
    );
    const sidebar = page.getByTestId('workspace-sidebar');
    for (const [name, area] of [
      ['terminal', 'workspace-area-terminal'],
      ['ai', 'workspace-area-ai'],
      ['ssh', 'workspace-area-ssh'],
    ] as const) {
      await sidebar.getByTestId(area).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}-${theme}-1440.png` });
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/settings-${theme}-1440.png` });
    expect(true).toBe(true);
  });
}
