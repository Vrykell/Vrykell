import { beforeEach, expect, it, vi } from 'vitest';
import type { ModelProfile } from '@features/agent';

const state = vi.hoisted(() => ({ models: [] as ModelProfile[], activeModel: 'one' }));
vi.mock('@features/agent', () => ({
  useAiConfigStore: { getState: () => state },
  setAiModels: async (models: ModelProfile[]) => { state.models = models; },
  setActiveModel: vi.fn(),
}));

import { updateModel, updateModelCapability } from './modelWrites';

beforeEach(() => {
  state.models = [{ id: 'one', name: 'One', provider: 'openai-compatible', baseUrl: '', model: 'sample',
    capabilities: { vision: false, reasoning: false, tools: true, search: false } }];
});

it('merges queued capability changes and retains unrelated flags', async () => {
  await Promise.all([updateModelCapability('one', 'vision', true), updateModelCapability('one', 'reasoning', true)]);
  expect(state.models[0]!.capabilities).toEqual({ vision: true, reasoning: true, tools: true, search: false });
});

it('uses detected defaults for older profiles and detects again after an identifier change', async () => {
  state.models[0]!.capabilities = undefined;
  await updateModelCapability('one', 'vision', true);
  expect(state.models[0]!.capabilities).toMatchObject({ vision: true, tools: true });
  await updateModel('one', { model: 'embedding' });
  expect(state.models[0]!.capabilities).toMatchObject({ vision: false, tools: false });
});
