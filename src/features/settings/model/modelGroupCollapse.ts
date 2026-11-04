/**
 * Persisted collapse state for the vendor groups in the model list.
 *
 * The list keeps one key per group label so a collapsed provider group stays collapsed after the
 * application restarts, not only while the settings page is mounted.
 */
export const MODEL_GROUP_COLLAPSE_KEY = 'vrykell-model-groups-collapsed';

export function readCollapsedModelGroups(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MODEL_GROUP_COLLAPSE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsedModelGroups(groups: ReadonlySet<string>): void {
  try {
    localStorage.setItem(MODEL_GROUP_COLLAPSE_KEY, JSON.stringify([...groups]));
  } catch {
    // Storage is optional in restricted windows; the in-memory state still works.
  }
}
