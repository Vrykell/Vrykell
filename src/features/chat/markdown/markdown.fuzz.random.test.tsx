/// <reference types="node" />
/**
 * 随机压测 Markdown 渲染管线 —— 种子化随机生成"markdown 敏感字符"串，
 * 轰炸 remark-gfm + remark-math + rehype-katex + CommandBlock，抓抛出异常的输入。
 * 命中时打印可复现的 JSON 串，加入 markdown.fuzz.test.tsx 的 NASTY 表。
 *
 * 运行：FUZZ=1 FUZZ_N=20000 npx vitest run src/chat/markdown.fuzz.random.test.tsx
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Markdown from '@/features/chat/markdown/Markdown';

// 确定性 PRNG（mulberry32）—— 同一种子序列完全可复现
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  '$',
  '$$',
  '`',
  '```',
  '~~~',
  '*',
  '**',
  '_',
  '__',
  '~',
  '~~',
  '|',
  '-',
  '#',
  '>',
  '!',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  '<',
  '>',
  'www.a.com',
  'https://x.y/z',
  'foo@bar.com',
  '中国',
  '🙂',
  '\\',
  '\\\\',
  '%',
  '&',
  ';',
  '=',
  '+',
  '^',
  '"',
  "'",
  ' ',
  '\n',
  '\n\n',
  'a',
  '1',
  'x^2',
  '\\frac',
  '{a}',
  '(bar)',
  'language-',
  '\tb',
  'E=mc^2',
  ' ',
  '‮',
  '​',
  '',
  '',
  '',
  '\ud83d',
  '\ude00', // 控制字符 + 孤立代理对
];

const RUN = process.env.FUZZ === '1';
const N = Number(process.env.FUZZ_N ?? 20000);
const SEED = Number(process.env.FUZZ_SE ?? 20260821);

describe.skipIf(!RUN)('Markdown 随机压测', () => {
  it(`${N} 例随机输入不抛异常（seed=${SEED}）`, () => {
    const rand = mulberry32(SEED);
    const failures: Array<{ i: number; content: string; error: string }> = [];
    for (let i = 0; i < N; i++) {
      const len = 1 + Math.floor(rand() * 24);
      let s = '';
      for (let j = 0; j < len; j++) s += TOKENS[Math.floor(rand() * TOKENS.length)];
      try {
        renderToStaticMarkup(createElement(Markdown, { content: s }));
      } catch (e) {
        failures.push({ i, content: s, error: String(e).slice(0, 300) });
        if (failures.length >= 5) break;
      }
    }
    if (failures.length > 0) {
      console.error('命中崩溃输入（JSON 可直接复现）:');
      for (const f of failures) console.error(JSON.stringify(f, null, 2));
    }
    expect(failures).toEqual([]);
  }, 300_000);
});
