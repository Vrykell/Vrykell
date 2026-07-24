import { describe, it, expect } from 'vitest';
import { detectRichContent, detectFirstBlock } from '../detector';

describe('detectRichContent', () => {
  it('detects display LaTeX with $$', () => {
    const { blocks } = detectRichContent('hello $$E=mc^2$$ world');
    // Note: inline detector also matches inside $$...$$; we assert the display block exists
    const display = blocks.find((b) => b.display === 'block');
    expect(display).toBeDefined();
    expect(display!.type).toBe('latex');
    expect(display!.content).toBe('E=mc^2');
  });

  it('detects inline LaTeX with $', () => {
    const { blocks } = detectRichContent('solve $x^2$ now');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].display).toBe('inline');
  });

  it('detects fenced code block with language', () => {
    const { blocks } = detectRichContent('```ts\nconst x = 1;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].language).toBe('ts');
    expect(blocks[0].content).toBe('const x = 1;\n');
  });

  it('detects markdown table', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { blocks } = detectRichContent(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
  });

  it('detects OSC AI markers and strips them from cleanedText', () => {
    const text = '\x1b]AI;CODE;ts\x1b\\const x = 1;\x1b]AI;END\x1b\\';
    const { blocks, cleanedText } = detectRichContent(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].language).toBe('ts');
    expect(cleanedText).toBe('const x = 1;');
  });

  it('strips ANSI before pattern matching', () => {
    const { blocks } = detectRichContent('\x1b[31m\x1b]0;title\x07$$x$$\x1b[0m');
    const display = blocks.find((b) => b.display === 'block');
    expect(display).toBeDefined();
    expect(display!.content).toBe('x');
  });
});

describe('detectFirstBlock', () => {
  it('returns first block only', () => {
    const block = detectFirstBlock('$$a$$\n```js\nb\n```');
    expect(block).not.toBeNull();
    expect(block!.type).toBe('latex');
  });

  it('returns null when nothing detected', () => {
    expect(detectFirstBlock('plain text')).toBeNull();
  });
});
