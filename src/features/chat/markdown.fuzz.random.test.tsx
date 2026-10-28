/// <reference types="node" />
/**
 * Random fuzzing of the Markdown render pipeline — seeded random generation of "markdown-sensitive character" strings,
 * hammering remark-gfm + remark-math + rehype-katex + CommandBlock to catch inputs that throw.
 * On a hit, print a reproducible JSON string and add it to the NASTY table in markdown.fuzz.test.tsx.
 *
 * Run: FUZZ=1 FUZZ_N=20000 npx vitest run src/chat/markdown.fuzz.random.test.tsx
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Markdown from '@features/chat/components/Markdown';

// Deterministic PRNG (mulberry32) — the same seed reproduces the sequence exactly
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  '$', '$$', '`', '```', '~~~', '*', '**', '_', '__', '~', '~~',
  '|', '-', '#', '>', '!', '[', ']', '(', ')', '{', '}', '<', '>',
  'www.a.com', 'https://x.y/z', 'foo@bar.com', '中国', '🙂',
  '\\', '\\\\', '%', '&', ';', '=', '+', '^', '"', "'", ' ',
  '\n', '\n\n', 'a', '1', 'x^2', '\\frac', '{a}', '(bar)', 'language-',
  '\tb', 'E=mc^2', ' ', '‮', '​',
  '', '', '', '\ud83d', '\ude00', // Control characters + lone surrogates
];

const RUN = process.env.FUZZ === '1';
const N = Number(process.env.FUZZ_N ?? 20000);
const SEED = Number(process.env.FUZZ_SE ?? 20260821);

describe.skipIf(!RUN)('Markdown random fuzz', () => {
  it(`${N} random inputs do not throw (seed=${SEED})`, () => {
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
      console.error('Crashing inputs found (the JSON reproduces them directly):');
      for (const f of failures) console.error(JSON.stringify(f, null, 2));
    }
    expect(failures).toEqual([]);
  }, 300_000);
});
