/**
 * providerMarkup — recognizes tool-call markup that an endpoint left in the answer text.
 *
 * Some Anthropic- or OpenAI-compatible proxies (DeepSeek's `/anthropic` endpoint among them)
 * occasionally stream the model's native call syntax as prose instead of a structured tool call.
 * The SDK then hands us plain text, no tool runs, and the turn simply ends — which looks like the
 * assistant stopped mid-thought. Recognizing the marker lets the transcript say what happened.
 *
 * Markers covered: the DSML block this endpoint emits, and the two spellings of the native
 * begin-of-calls token. There is no lookbehind: macOS webviews reject it.
 */
const LEAKED_TOOL_MARKUP = /<\s*(?:[|｜]\s*){1,2}DSML\s*(?:[|｜]\s*){1,2}(calls|invoke|parameter)\b|<\s*[|｜]\s*tool[_▁]calls[_▁]begin\s*[|｜]\s*>/i;

export function hasLeakedToolCallMarkup(text: string): boolean {
  return LEAKED_TOOL_MARKUP.test(text);
}

export function visibleAssistantText(text: string): string {
  let remaining = text;
  let visible = '';
  let match = LEAKED_TOOL_MARKUP.exec(remaining);
  while (match) {
    visible += remaining.slice(0, match.index);
    const suffix = remaining.slice(match.index + match[0].length);
    const closing = match[1]
      ? new RegExp(`<\\s*\\/\\s*(?:[|｜]\\s*){1,2}DSML\\s*(?:[|｜]\\s*){1,2}${match[1]}\\s*>`, 'i').exec(suffix)
      : /<\s*[|｜]\s*tool[_▁]calls[_▁]end\s*[|｜]\s*>/i.exec(suffix);
    if (!closing) return visible;
    remaining = suffix.slice(closing.index + closing[0].length);
    match = LEAKED_TOOL_MARKUP.exec(remaining);
  }
  const start = remaining.lastIndexOf('<');
  if (start >= 0) {
    const fragment = remaining.slice(start).replace(/\s/g, '').replace(/｜/g, '|').replace(/▁/g, '_').toLowerCase();
    const prefixes = ['<|dsml|calls', '<||dsml||calls', '<|dsml|invoke', '<||dsml||invoke', '<|dsml|parameter', '<||dsml||parameter', '<|tool_calls_begin|>'];
    if (prefixes.some(prefix => prefix.startsWith(fragment))) return visible + remaining.slice(0, start);
  }
  return visible + remaining;
}
