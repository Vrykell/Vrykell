import { describe, expect, it } from 'vitest';
import { captureConnectionFrame, needsSecretResponse, secretResponsePrompt, secretResponseWasRejected } from './terminalFrame';
import { Terminal } from '@xterm/xterm';

describe('SSH secret response prompts', () => {
  it('captures styled authentication states but reuses normal interactive frames', async () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    const write = (text: string) => new Promise<void>(resolve => term.write(text, resolve));
    try {
      await write('Password: ');
      const authentication = captureConnectionFrame(term, null);
      expect(authentication.html).toContain('Password:');
      expect(captureConnectionFrame(term, authentication)).toBe(authentication);
      await write('\r\nWelcome\r\n');
      const interactive = captureConnectionFrame(term, authentication);
      expect(interactive.html).toBe('');
      await write('regular-screen-update');
      expect(captureConnectionFrame(term, interactive)).toBe(interactive);
      const disconnected = captureConnectionFrame(term, interactive, true);
      expect(disconnected.html).toContain('regular-screen-update');
    } finally { term.dispose(); }
  });

  it('recognizes the final password or passphrase prompt', () => {
    expect(secretResponsePrompt('Welcome\nPassword: ')).toBe('Password:');
    expect(needsSecretResponse('密钥口令：')).toBe(true);
    expect(secretResponsePrompt('Password: accepted\nWelcome')).toBeNull();
  });

  it('detects an authentication rejection immediately before a repeated prompt', () => {
    expect(secretResponseWasRejected('Permission denied, please try again.\nPassword:')).toBe(true);
    expect(secretResponseWasRejected('已登录交互程序\nPassword:')).toBe(false);
  });
});
