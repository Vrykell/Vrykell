import { describe, it, expect } from 'vitest';
import {
  buildStartMarker,
  END_MARKER,
  wrapWithMarkers,
  parseMarker,
} from './osc-ai';

describe('protocol', () => {
  it('builds start marker with param', () => {
    expect(buildStartMarker('LATEX', 'inline')).toBe('\x1b]AI;LATEX;inline\x1b\\');
  });

  it('builds start marker without param', () => {
    expect(buildStartMarker('CODE', 'ts')).toBe('\x1b]AI;CODE;ts\x1b\\');
    expect(buildStartMarker('MARKDOWN')).toBe('\x1b]AI;MARKDOWN\x1b\\');
  });

  it('wraps content with markers', () => {
    const wrapped = wrapWithMarkers('LATEX', 'x^2', 'inline');
    expect(wrapped).toBe('\x1b]AI;LATEX;inline\x1b\\x^2\x1b]AI;END\x1b\\');
  });

  it('parses marker with param', () => {
    expect(parseMarker('AI;CODE;ts')).toEqual({ type: 'CODE', param: 'ts' });
  });

  it('parses marker without param', () => {
    expect(parseMarker('AI;MARKDOWN')).toEqual({ type: 'MARKDOWN' });
  });

  it('returns null for invalid marker', () => {
    expect(parseMarker('FOO;BAR')).toBeNull();
    expect(parseMarker('')).toBeNull();
  });
});
