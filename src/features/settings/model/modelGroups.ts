/**
 * modelGroups — the model list's grouping and filtering.
 *
 * The list groups by the vendor the row's mark already identifies (endpoint host first, then the
 * model family), so one relay endpoint that serves several vendors still reads as separate
 * sections instead of a single flat list.
 */
import type { ModelProfile } from '@features/agent';
import { modelVendor, modelVendorInfo } from '@features/agent/components/modelIcon';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';

export interface ModelGroup {
  key: string;
  label: string;
  models: ModelProfile[];
}

/** Group one provider's models by their vendor, in the order the first entry appears. */
export function groupModelsByVendor(models: ModelProfile[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const vendor = modelVendor(model.provider, model.model, model.baseUrl);
    const group = groups.get(vendor)
      ?? { key: vendor, label: modelVendorInfo(model.provider, model.model, model.baseUrl).label, models: [] };
    group.models.push(model);
    groups.set(vendor, group);
  }
  return [...groups.values()];
}

/** Search matches the display name and the API model id; the capability filter keeps one kind. */
export function filterModels(
  models: ModelProfile[],
  query: string,
  capability: ModelCapability | 'all',
): ModelProfile[] {
  const needle = query.trim().toLowerCase();
  return models.filter((model) => {
    if (needle && !`${model.name} ${model.model}`.toLowerCase().includes(needle)) return false;
    if (capability === 'all') return true;
    const caps = model.capabilities ?? detectCapabilities(model.provider, model.model);
    return Boolean(caps[capability]);
  });
}
