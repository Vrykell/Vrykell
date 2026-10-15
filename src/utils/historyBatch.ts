/** Process each record once, in display order, and keep individual failures retryable. */
export async function runHistoryBatch<T extends { id: string }>(records: readonly T[], action: (record: T) => Promise<void>) {
  const succeeded: T[] = [];
  const failed: T[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    try {
      await action(record);
      succeeded.push(record);
    } catch {
      failed.push(record);
    }
  }
  return { succeeded, failed };
}
