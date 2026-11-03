/**
 * harnessOptions — which session config option the composer treats as a permission mode or a model.
 *
 * Agents publish the same concepts through config options or the older mode/model fields. The page
 * and the remembered-config restore share these classifiers so both agree on the mapping.
 */
import type { AcpConfigOption } from '@platform/api/acp';

const permissionIds = ['mode', 'approval_mode', 'approval_policy', 'permission_mode'];

/** A config option that changes what the agent may do, shown as the permission choice. */
export function isPermissionOption(option: AcpConfigOption): boolean {
  return permissionIds.includes(option.id) || option.category === 'mode' && option.id !== 'collaboration_mode';
}

/** A config option that selects the model, shown on the composer's right side. */
export function isModelOption(option: AcpConfigOption): boolean {
  return option.category === 'model' || option.id === 'model';
}

/** Every value a select option offers, with grouped values flattened into one list. */
export function optionValues(option: AcpConfigOption): string[] {
  return (option.options ?? []).flatMap((entry) => 'group' in entry
    ? entry.options.map((value) => value.value)
    : [entry.value]);
}
