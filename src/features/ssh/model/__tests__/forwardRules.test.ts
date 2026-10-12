import { describe, expect, it } from 'vitest';
import { formatForwardRules, parseForwardTexts } from '../forwardRules';

describe('forwarding editor conversion', () => {
  it('round trips local, remote and SOCKS rules including IPv6 and bind addresses', () => {
    const texts = { local: '8080:localhost:80\n[::1]:9000:[2001:db8::1]:443', remote: '127.0.0.1:2222:localhost:22', dynamic: '1080\n[::1]:1081' };
    const rows = parseForwardTexts(texts);
    expect(rows).not.toBeNull();
    expect(formatForwardRules(rows!)).toEqual(texts);
  });
  it('refuses a mode conversion that would discard invalid text', () => {
    expect(parseForwardTexts({ local: 'invalid', remote: '', dynamic: '' })).toBeNull();
  });
  it('keeps incomplete GUI fields visible to validation rather than dropping the draft', () => {
    expect(formatForwardRules([{ id: 'draft', kind: 'local', bind: '', port: '8080', host: 'localhost', targetPort: '' }])).toEqual({ local: '8080:localhost:', remote: '', dynamic: '' });
  });
  it('quotes IPv6 addresses entered without brackets', () => {
    expect(formatForwardRules([{ id: 'v6', kind: 'local', bind: '::1', port: '8080', host: '2001:db8::1', targetPort: '443' }]).local).toBe('[::1]:8080:[2001:db8::1]:443');
  });
});
