import { describe, it, expect } from 'vitest';
import { sanitizeOutputHtml } from '@utils/sanitizeHtml';

describe('sanitizeOutputHtml', () => {
  it.each(['u\\72l(https://example.invalid/image)', 'image-set("https://example.invalid/image" 1x)', 'u/**/rl(https://example.invalid/image)'])('rejects encoded or alternate image style sources %s', value => {
    const span = document.createElement('span');
    span.setAttribute('style', `background:${value}`);
    span.textContent = 'safe';
    expect(sanitizeOutputHtml(span.outerHTML)).toBe('<span>safe</span>');
  });
  it('removes every attribute from line breaks', () => {
    expect(sanitizeOutputHtml('<br onclick="alert(1)" onmouseover="alert(2)" style="color:red" id="target" tabindex="0">')).toBe('<br>');
  });
  it('keeps the generator span + safe style + br structure', () => {
    const html = '<span style="color:#cc0000">红</span><br><span style="font-weight:bold;display:inline-block;width:2ch">字</span>';
    expect(sanitizeOutputHtml(html)).toBe(
      '<span style="color:#cc0000">红</span><br><span style="font-weight:bold;display:inline-block;width:2ch">字</span>',
    );
  });

  it('keeps a bounded letter-spacing correction and rejects abnormal letter-spacing values', () => {
    expect(sanitizeOutputHtml('<span style="letter-spacing:-0.01em">text</span>'))
      .toBe('<span style="letter-spacing:-0.01em">text</span>');
    expect(sanitizeOutputHtml('<span style="letter-spacing:2em">text</span>'))
      .toBe('<span>text</span>');
    expect(sanitizeOutputHtml('<span style="letter-spacing:calc(1px)">text</span>'))
      .toBe('<span>text</span>');
  });

  it('script tags are removed (only text remains)', () => {
    const html = '<span style="color:#000">ok</span><script>alert(1)</script>';
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:#000">ok</span>alert(1)');
  });

  it('event handlers and dangerous attributes are stripped', () => {
    const html = '<span onclick="alert(1)" onmouseover="x()" id="a" class="b">t</span>';
    expect(sanitizeOutputHtml(html)).toBe('<span>t</span>');
  });

  it('javascript: links and img onerror are discarded', () => {
    const html = '<a href="javascript:alert(1)">点我</a><img src=x onerror="alert(1)">';
    expect(sanitizeOutputHtml(html)).toBe('点我');
  });

  it('attributes outside the style whitelist are rejected (including dangerous values)', () => {
    const html = '<span style="color:red;position:fixed;background:url(javascript:alert(1));width:2ch">t</span>';
    // position is not whitelisted and the background value contains url() -> both are dropped
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:red;width:2ch">t</span>');
  });

  it('nested dangerous tags degrade to text as a whole', () => {
    const html = '<span>a</span><div><script>evil()</script><span style="color:#00f">b</span></div>';
    const out = sanitizeOutputHtml(html);
    expect(out).toContain('<span>a</span>');
    expect(out).toContain('evil()');
    expect(out).toContain('<span style="color:#00f">b</span>');
    expect(out).not.toContain('<div>');
  });

  it('plain text / empty input is returned unchanged', () => {
    expect(sanitizeOutputHtml('')).toBe('');
    expect(sanitizeOutputHtml('plain text')).toBe('plain text');
  });

  it('entities are preserved (&amp; &lt; survive the round trip)', () => {
    const html = '<span style="color:#000">a &amp; b &lt;c&gt;</span>';
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:#000">a &amp; b &lt;c&gt;</span>');
  });
});
