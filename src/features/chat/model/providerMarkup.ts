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
const LEAKED_TOOL_MARKUP =
  /\uFF5C\uFF5CDSML\uFF5C\uFF5C\s*(?:calls>|invoke)|<\uFF5Ctool\u2581calls\u2581begin\uFF5C>|<\|tool_calls_begin\|>/;

export function hasLeakedToolCallMarkup(text: string): boolean {
  return LEAKED_TOOL_MARKUP.test(text);
}
