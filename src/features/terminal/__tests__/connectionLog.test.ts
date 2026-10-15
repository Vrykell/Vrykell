import { expect, it } from 'vitest';
import { appendLogEntry, connectionLogLines, isSshClientNotice } from '../model/connectionLog';

it('bounds each log entry and the total history', () => {
  expect(connectionLogLines(`Warning: ${'x'.repeat(100000)}`)[0].length).toBeLessThanOrEqual(1024);
  let entries: { time: number; text: string }[] = [];
  for (let i = 0; i < 100; i++) entries = appendLogEntry(entries, { time: i, text: String(i) });
  expect(entries).toHaveLength(60);
});

it('redacts labeled secrets and excludes shell output even without readiness markers', () => {
  const lines = connectionLogLines('Warning: password=dummy-secret\r\nroot@host:~$ cat credentials\r\nprivate-output');
  const notices = lines.filter(isSshClientNotice);
  expect(notices).toEqual(['Warning: password=[redacted]']);
  expect(notices.join('')).not.toContain('dummy-secret');
  expect(notices.join('')).not.toContain('private-output');
});
