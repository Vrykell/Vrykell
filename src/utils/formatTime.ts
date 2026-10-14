/** Clock time of a message timestamp in the reader's locale, e.g. 11:03 or 11:03 AM. */
export function formatMessageTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
