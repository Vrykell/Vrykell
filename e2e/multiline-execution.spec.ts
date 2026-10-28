import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setupTauriMock, ptyWrites } from './tauri-mock';
import { formatCommandSubmission } from '../src/features/terminal/model/commandSubmission';

const linux = process.platform === 'linux' ? { file: '/bin/sh', prefix: [] as string[] }
  : process.platform === 'win32' && spawnSync('wsl.exe', ['-d', 'docker-desktop', '--exec', 'uname', '-s'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).stdout?.includes('Linux')
    ? { file: 'wsl.exe', prefix: ['-d', 'docker-desktop', '--exec', '/bin/sh'] } : null;

const script = [
  'IFS= read -r -t 1 stolen || :',
  "printf '__REQUIRED_LINE__\\n'",
  'printf \'__STOLEN__:%s\\n\' "$stolen"',
  "cat <<'TEXT'",
  "  '$HOME' \\ quotes and 中文 😀",
  '',
  'TEXT',
  "check_value() { printf '__FUNCTION__:%s\\n' \"$1\"; }",
  "check_value 'script function'",
  "export MULTILINE_PROBE='retained'",
  'cd /tmp',
  "printf '__SCRIPT_DONE__\\n'",
].join('\n');

/** Exercise a real interactive pseudoterminal, including host Enter normalization. */
function runLinuxPty(payload: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    if (!linux) { reject(new Error('Linux pseudoterminal unavailable')); return; }
    const child = spawn(linux.file, [...linux.prefix, '-c',
      'export PS1="" PS2="" TERM=dumb; timeout 8 script -q -e -c "stty -echo; printf \'__PTY_READY__\\n\'; if [ -x /bin/bash ]; then exec /bin/bash --noprofile --norc -i; else exec /bin/sh; fi" /dev/null'], { windowsHide: true });
    let output = ''; let submitted = false; let checked = false;
    const deadline = setTimeout(() => { child.kill(); reject(new Error(`Pseudoterminal timed out: ${output}`)); }, 12000);
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString('utf8');
      if (!submitted && output.includes('__PTY_READY__')) {
        submitted = true;
        child.stdin.write(payload.replace(/\r\n|\n/g, '\r'));
      }
      if (!checked && /(?:^|\n)__SCRIPT_DONE__\r?(?:\n|$)/.test(output)) {
        checked = true;
        child.stdin.end('printf \'__PARENT__:%s|%s\\n\' "$MULTILINE_PROBE" "$PWD"\rexit\r');
      }
    });
    child.stderr.on('data', (bytes: Buffer) => { output += bytes.toString('utf8'); });
    child.on('close', code => { clearTimeout(deadline); resolve({ code, output: output.replace(/\r/g, '') }); });
  });
}

test('a real Linux PTY reproduces raw multiline loss and executes a complete submission', async () => {
  test.skip(!linux, 'Requires a Linux pseudoterminal with script and timeout.');
  const broken = await runLinuxPty(`${script}\n`);
  // Interactive line editors can steal queued lines or stall before the script completes.
  expect([0, 124], broken.output).toContain(broken.code);
  expect(broken.output).not.toContain('\n__REQUIRED_LINE__\n');
  expect(broken.code === 124 || broken.output.includes("__STOLEN__:printf '__REQUIRED_LINE__\\n'"), broken.output).toBe(true);
  const fixed = await runLinuxPty(formatCommandSubmission(script, 'posix'));
  expect(fixed.code, fixed.output).toBe(0);
  expect(fixed.output).toContain('\n__REQUIRED_LINE__\n');
  expect(fixed.output).toContain('\n__STOLEN__:\n');
  expect(fixed.output).toContain("  '$HOME' \\ quotes and 中文 😀\n\n");
  expect(fixed.output).toContain('__FUNCTION__:script function');
  expect(fixed.output).toContain('__PARENT__:retained|/tmp');
});

for (const target of ['local', 'remote'] as const) test(`${target} composer submits a complete script that runs in a real Linux PTY`, async ({ page }) => {
  test.skip(!linux, 'Requires a Linux pseudoterminal with script and timeout.');
  await setupTauriMock(page);
  await page.goto('/');
  if (target === 'remote') {
    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await page.evaluate(async script => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore, getFocusedTerminalId } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      useTerminalStore.getState().stageCommand(getFocusedTerminalId(), script);
    }, script);
  } else {
    await page.getByTestId('tab-new-btn').click();
    await page.getByRole('button', { name: /Bash/ }).click();
  }
  const input = page.locator('[data-terminal-input]:visible');
  await expect(input).toBeVisible();
  await input.fill(script);
  const before = (await ptyWrites(page)).length;
  await input.press('Enter');
  await expect.poll(async () => (await ptyWrites(page)).slice(before).length).toBeGreaterThan(0);
  const payload = (await ptyWrites(page)).slice(before).join('');
  expect(payload.trimEnd()).not.toMatch(/[\r\n]/);
  const result = await runLinuxPty(payload);
  expect(result.code, result.output).toBe(0);
  expect(result.output).toContain('\n__REQUIRED_LINE__\n');
  expect(result.output).toContain('\n__STOLEN__:\n');
  expect(result.output).toContain('__FUNCTION__:script function');
  expect(result.output).toContain('__PARENT__:retained|/tmp');
});

test('multiline Bash execution preserves heredocs, state and the final exit status', () => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/bash.exe' : '/bin/bash';
  test.skip(!existsSync(bash), 'Requires Bash.');
  const source = "value='persisted'\nread -r line\ncat <<'TEXT'\nliteral $value and 'quotes'\nTEXT\nprintf 'value:%s input:%s\\n' \"$value\" \"$line\"\nfalse";
  const payload = formatCommandSubmission(source, 'posix');
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', `export PATH=/usr/bin:/bin\n${payload}status=$?; printf 'parent:%s status:%s\\n' "$value" "$status"`], { input: 'input value\n', encoding: 'utf8', windowsHide: true });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("literal $value and 'quotes'");
  expect(result.stdout).toContain('value:persisted input:input value');
  expect(result.stdout).toContain('parent:persisted status:1');
});

test('multiline native shell execution retains variables and functions', () => {
  test.skip(process.platform !== 'win32', 'Requires the native shell.');
  const source = "$value = 'persisted'\nfunction Read-Probe { $value }\nRead-Probe";
  const payload = formatCommandSubmission(source, 'powershell');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${payload}Write-Output "parent:$value"; Read-Probe`], { encoding: 'utf8', windowsHide: true });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('parent:persisted');
  expect(result.stdout.match(/persisted/g)?.length).toBe(3);
});
