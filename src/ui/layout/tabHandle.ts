import type { ReactNode } from 'react';

/**
 * Behaviour a tab row exposes without knowing its domain type.
 *
 * The strip renders the handle; the owning provider decides which controls exist.
 */
export interface TabCapabilities {
  /** Allow in-place rename from the tab row. */
  renameable: boolean;
  /** A session row may join a named session group. */
  groupable: boolean;
}

export const DEFAULT_TAB_CAPABILITIES: Readonly<TabCapabilities> = Object.freeze({
  renameable: false,
  groupable: false,
});

/** Build capabilities from the defaults so callers only state what differs. */
export function tabCapabilities(overrides: Partial<TabCapabilities> = {}): TabCapabilities {
  return { ...DEFAULT_TAB_CAPABILITIES, ...overrides };
}

/**
 * One row of a tab strip.
 *
 * This is a projection: identity, presentation and capabilities only. Domain state and
 * lifecycle stay in the provider that produced the handle.
 */
export interface TabHandle {
  id: string;
  label: string;
  icon: ReactNode;
  tip: string;
  closeLabel: string;
  closeTestId?: string;
  dataAttributes?: Record<string, string>;
  surface?: 'canvas';
  capabilities: TabCapabilities;
}
