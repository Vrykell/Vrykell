import { describe, expect, it } from 'vitest';
import { hasLeakedToolCallMarkup } from './providerMarkup';

describe('hasLeakedToolCallMarkup', () => {
  it('spots the call block an endpoint streamed as text', () => {
    const leaked = '<\uFF5C\uFF5CDSML\uFF5C\uFF5C calls>\n'
      + '<\uFF5C\uFF5CDSML\uFF5C\uFF5C invoke name="run_command">\n'
      + '<\uFF5C\uFF5CDSML\uFF5C\uFF5C parameter name="command">dir</\uFF5C\uFF5CDSML\uFF5C\uFF5C parameter>\n'
      + '</\uFF5C\uFF5CDSML\uFF5C\uFF5C invoke>\n</\uFF5C\uFF5CDSML\uFF5C\uFF5C calls>';
    expect(hasLeakedToolCallMarkup(leaked)).toBe(true);
  });

  it('spots the native begin-of-calls token in both spellings', () => {
    expect(hasLeakedToolCallMarkup('sure<\uFF5Ctool\u2581calls\u2581begin\uFF5C>{}')).toBe(true);
    expect(hasLeakedToolCallMarkup('sure<|tool_calls_begin|>{}')).toBe(true);
  });

  it('leaves ordinary answers alone', () => {
    expect(hasLeakedToolCallMarkup('I ran `dir` and it lists four files.')).toBe(false);
    expect(hasLeakedToolCallMarkup('')).toBe(false);
    expect(hasLeakedToolCallMarkup('```json\n{"name": "run_command"}\n```')).toBe(false);
  });
});
