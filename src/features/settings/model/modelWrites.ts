/**
 * modelWrites — serialized writes for the model list.
 *
 * Model edits arrive from several rows at once (text inputs commit on blur, selects on change), so
 * every write is queued and merged with the latest persisted list instead of a stale snapshot.
 */
import { setAiModels, setActiveModel, useAiConfigStore, type ModelProfile } from '@features/agent';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';

let modelWrites = Promise.resolve();

export function commitModels(transform: (models: ModelProfile[]) => ModelProfile[]) {
  const write = modelWrites.then(() => {
    const current = useAiConfigStore.getState();
    const next = transform(current.models);
    return setAiModels(next, next.some(model => model.id === current.activeModel) ? current.activeModel : next[0]!.id);
  });
  modelWrites = write.catch(() => {});
  return write;
}

/** Patch one model row; a provider or identifier change recalculates its capabilities. */
export function updateModel(id: string, patch: Partial<ModelProfile>) {
  return commitModels(current => current.map(model => {
    if (model.id !== id) return model;
    const next = { ...model, ...patch };
    if (patch.model !== undefined || patch.provider !== undefined) {
      next.capabilities = detectCapabilities(next.provider, next.model);
    }
    return next;
  }));
}

export function updateModelCapability(id: string, capability: ModelCapability, supported: boolean) {
  return commitModels(current => current.map(model => model.id !== id ? model : {
    ...model, capabilities: { ...(model.capabilities ?? detectCapabilities(model.provider, model.model)), [capability]: supported },
  }));
}

export function resetModelCapabilities(id: string) {
  return commitModels(current => current.map(model => model.id !== id ? model : {
    ...model, capabilities: detectCapabilities(model.provider, model.model),
  }));
}

export function selectModel(id: string) {
  const write = modelWrites.then(() => setActiveModel(id));
  modelWrites = write.catch(() => {});
  return write;
}

export const newModelId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
