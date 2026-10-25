import { describe, expect, it } from 'vitest';
import { hasLeakedToolCallMarkup, visibleAssistantText } from './providerMarkup';

describe('hasLeakedToolCallMarkup', () => {
  it('removes spaced native call markup while retaining surrounding answer text', () => {
    const raw = 'Before\n< | DSML | calls>< | DSML | invoke name="run_command">< | DSML | parameter name="command">dangerous text</ | DSML | parameter></ | DSML | invoke></ | DSML | calls>\nAfter';
    expect(hasLeakedToolCallMarkup(raw)).toBe(true);
    expect(visibleAssistantText(raw)).toBe('Before\n\nAfter');
    expect(visibleAssistantText('Before<|tool_calls_begin|>{"command":"do not run"}<|tool_calls_end|>After')).toBe('BeforeAfter');
    expect(visibleAssistantText('Before<｜｜DSML｜｜ calls>unfinished')).toBe('Before');
    expect(visibleAssistantText('partial < | D')).toBe('partial ');
    expect(visibleAssistantText('normal a < 3 and JSON {"command":"example"}')).toBe('normal a < 3 and JSON {"command":"example"}');
  });
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
