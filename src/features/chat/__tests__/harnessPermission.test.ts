/**
 * Harness permission answers — one card may only answer the request instance it was drawn on.
 *
 * A harness can ask twice for the same tool call (a retry, a re-prompt). The card carries the
 * generation of the request it rendered, and an answer stamped with an older generation is dropped
 * instead of landing on the newer request: the user decided about the card they saw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '@features/chat/stores/harness';
import { acpAnswerPermission } from '@platform/api/acp';

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpCancel: vi.fn(async () => undefined),
  acpClose: vi.fn(async () => undefined),
  acpOpen: vi.fn(async () => ({ sessionId: 's1', agent: { agentInfo: { name: 'Fake' } } })),
  acpPrompt: vi.fn(async () => undefined),
  onAcpSession: vi.fn(async () => () => {}),
}));

const TAB = 'tab-1';

const ask = (title = 'Run a command') => ({
  kind: 'permission',
  sessionId: 's1',
  payload: {
    toolCall: { toolCallId: 'call-1', title },
    options: [{ optionId: 'allow', name: 'Allow' }, { optionId: 'deny', name: 'Deny' }],
  },
});

beforeEach(async () => {
  vi.mocked(acpAnswerPermission).mockClear();
  useHarnessStore.setState({ byTab: {} });
  await useHarnessStore.getState().open(TAB, 'Fake ACP', '');
});

describe('harness permission answers', () => {
  it('carries the request generation on the card', () => {
    const session = useHarnessStore.getState().byTab[TAB];
    useHarnessStore.getState().applyEvent(ask() as never);

    expect(useHarnessStore.getState().byTab[TAB]!.permission).toMatchObject({ toolCallId: 'call-1', generation: 1 });
    expect(session).toBeTruthy();
  });

  it('drops an answer stamped with an older generation and keeps the newer card', async () => {
    useHarnessStore.getState().applyEvent(ask('First') as never);
    useHarnessStore.getState().applyEvent(ask('Second') as never);
    expect(useHarnessStore.getState().byTab[TAB]!.permission).toMatchObject({ title: 'Second', generation: 2 });

    await useHarnessStore.getState().answerPermission(TAB, 1, 'allow');

    expect(acpAnswerPermission).not.toHaveBeenCalled();
    expect(useHarnessStore.getState().byTab[TAB]!.permission).toMatchObject({ title: 'Second', generation: 2 });
  });

  it('answers the request the card belongs to, and clears the card', async () => {
    useHarnessStore.getState().applyEvent(ask() as never);

    await useHarnessStore.getState().answerPermission(TAB, 1, 'allow');

    expect(acpAnswerPermission).toHaveBeenCalledWith('call-1', 'allow');
    expect(useHarnessStore.getState().byTab[TAB]!.permission).toBeNull();
  });

  it('treats a click on a card that is already gone as nothing', async () => {
    await useHarnessStore.getState().answerPermission(TAB, 1, null);

    expect(acpAnswerPermission).not.toHaveBeenCalled();
  });
});
