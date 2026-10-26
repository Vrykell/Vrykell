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
  it('保留生成器的 span + 安全 style + br 结构', () => {
    const html = '<span style="color:#cc0000">红</span><br><span style="font-weight:bold;display:inline-block;width:2ch">字</span>';
    expect(sanitizeOutputHtml(html)).toBe(
      '<span style="color:#cc0000">红</span><br><span style="font-weight:bold;display:inline-block;width:2ch">字</span>',
    );
  });

  it('保留受限的字距修正并拒绝异常字距值', () => {
    expect(sanitizeOutputHtml('<span style="letter-spacing:-0.01em">text</span>'))
      .toBe('<span style="letter-spacing:-0.01em">text</span>');
    expect(sanitizeOutputHtml('<span style="letter-spacing:2em">text</span>'))
      .toBe('<span>text</span>');
    expect(sanitizeOutputHtml('<span style="letter-spacing:calc(1px)">text</span>'))
      .toBe('<span>text</span>');
  });

  it('脚本标签被移除（仅剩文本）', () => {
    const html = '<span style="color:#000">ok</span><script>alert(1)</script>';
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:#000">ok</span>alert(1)');
  });

  it('事件处理器与危险属性被剥离', () => {
    const html = '<span onclick="alert(1)" onmouseover="x()" id="a" class="b">t</span>';
    expect(sanitizeOutputHtml(html)).toBe('<span>t</span>');
  });

  it('javascript: 链接与 img onerror 被丢弃', () => {
    const html = '<a href="javascript:alert(1)">点我</a><img src=x onerror="alert(1)">';
    expect(sanitizeOutputHtml(html)).toBe('点我');
  });

  it('style 白名单之外的属性被拒绝（含危险值）', () => {
    const html = '<span style="color:red;position:fixed;background:url(javascript:alert(1));width:2ch">t</span>';
    // position 不在白名单、background 值含 url() → 都被丢弃
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:red;width:2ch">t</span>');
  });

  it('嵌套危险标签整体降级为文本', () => {
    const html = '<span>a</span><div><script>evil()</script><span style="color:#00f">b</span></div>';
    const out = sanitizeOutputHtml(html);
    expect(out).toContain('<span>a</span>');
    expect(out).toContain('evil()');
    expect(out).toContain('<span style="color:#00f">b</span>');
    expect(out).not.toContain('<div>');
  });

  it('纯文本 / 空输入原样返回', () => {
    expect(sanitizeOutputHtml('')).toBe('');
    expect(sanitizeOutputHtml('plain text')).toBe('plain text');
  });

  it('实体保留（&amp; &lt; 往返不丢）', () => {
    const html = '<span style="color:#000">a &amp; b &lt;c&gt;</span>';
    expect(sanitizeOutputHtml(html)).toBe('<span style="color:#000">a &amp; b &lt;c&gt;</span>');
  });
});
