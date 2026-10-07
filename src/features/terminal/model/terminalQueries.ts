/**
 * The control sequences a program sends when it wants the terminal to answer.
 *
 * A terminal that stays silent can leave a program on its first screen: the program
 * cannot tell "not supported" from "not there yet". Listing the questions a session
 * asked makes that visible in the diagnostics log without recording output.
 */

/** CSI sequences that ask something: attributes, status, version, mode query, keyboard protocol. */
const CSI_QUERY = /\x1b\[[0-9;?>=]*\$?[cnqpu]/g;

/** OSC sequences that ask something, e.g. a colour request. */
const OSC_QUERY = /\x1b\][0-9]+;\?/g;

/** A readable list of the questions in this chunk, without the payload around them. */
export function querySequences(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.match(CSI_QUERY) ?? []) found.add(match);
  for (const match of text.match(OSC_QUERY) ?? []) found.add(match);
  return Array.from(found);
}
