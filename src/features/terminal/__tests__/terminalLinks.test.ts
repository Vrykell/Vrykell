import { describe, expect, it } from 'vitest';

describe('terminal link detection', () => {
  it('detects http URLs', () => {
    const text = 'Visit https://example.com for more info';
    const re = /https?:\/\/[^\s]+/g;
    const matches = text.match(re);
    expect(matches).toContain('https://example.com');
  });

  it('detects file paths', () => {
    const text = 'Open /Users/test/file.txt to edit';
    const re = /(?:\/[\w.-]+)+/g;
    const matches = text.match(re);
    expect(matches).toContain('/Users/test/file.txt');
  });

  it('detects git URLs', () => {
    const text = 'Clone from git@github.com:user/repo.git';
    const re = /git@[\w.]+:[\w./-]+/g;
    const matches = text.match(re);
    expect(matches).toContain('git@github.com:user/repo.git');
  });

  it('detects email addresses', () => {
    const text = 'Contact user@example.com for help';
    const re = /[\w.+-]+@[\w-]+\.[\w.]+/g;
    const matches = text.match(re);
    expect(matches).toContain('user@example.com');
  });
});
