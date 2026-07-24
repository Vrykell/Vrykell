/**
 * Rich content protocol definitions.
 * AI tools output OSC escape sequences that the terminal parses and renders.
 *
 * Format: ESC ] AI ; TYPE ; PARAMS ESC \ content ESC ] AI ; END ESC \
 *
 * OSC code 6969 is used (0x1B39 in hex, assigned to "AI Terminal").
 */

export const OSC_AI_CODE = 6969;

export const MARKER_START_PREFIX = 'AI;';
export const MARKER_END = 'AI;END';

export type AIMarkerType = 'LATEX' | 'MARKDOWN' | 'CODE' | 'IMAGE';

/**
 * Build an OSC AI start marker sequence.
 * Example: buildStartMarker('LATEX', 'inline') → "\x1b]AI;LATEX;inline\x1b\\"
 */
export function buildStartMarker(type: AIMarkerType, param?: string): string {
  const payload = param ? `AI;${type};${param}` : `AI;${type}`;
  return `\x1b]${payload}\x1b\\`;
}

/** The end marker for any AI content block */
export const END_MARKER = '\x1b]AI;END\x1b\\';

/**
 * Serialize content for terminal output with AI markers.
 */
export function wrapWithMarkers(type: AIMarkerType, content: string, param?: string): string {
  return buildStartMarker(type, param) + content + END_MARKER;
}

/**
 * Parse an OSC AI marker string to extract type and param.
 * e.g. "AI;LATEX;inline" → { type: 'LATEX', param: 'inline' }
 *      "AI;MARKDOWN" → { type: 'MARKDOWN', param: undefined }
 */
export function parseMarker(data: string): { type: AIMarkerType; param?: string } | null {
  if (!data.startsWith(MARKER_START_PREFIX)) return null;
  const parts = data.slice(MARKER_START_PREFIX.length).split(';');
  if (parts.length < 1) return null;
  const type = parts[0] as AIMarkerType;
  const param = parts.length > 1 ? parts[1] : undefined;
  // Validate type
  if (!['LATEX', 'MARKDOWN', 'CODE', 'IMAGE'].includes(type)) return null;
  return { type, param };
}
