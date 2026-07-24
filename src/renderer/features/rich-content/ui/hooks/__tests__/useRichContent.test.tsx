import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useRichContent } from '../useRichContent';
import { useTerminalStore } from '../../../../../stores/terminal-store';
import { FakeTauriBackend } from '../../../../../../test/fake-tauri';

vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/event');

function Wrapper({ sessionId }: { sessionId: string }) {
  useRichContent(sessionId);
  return null;
}

describe('useRichContent integration', () => {
  let backend: FakeTauriBackend;

  beforeEach(() => {
    backend = new FakeTauriBackend();
    backend.install();
    useTerminalStore.setState({
      sessions: [], activeSessionId: null, richOutputs: {},
      settings: useTerminalStore.getState().settings,
      aiMessages: [], aiStreaming: false,
      sidebarOpen: false, outputPanelOpen: false, outputPanelHeight: 200,
    });
  });

  it('detects code block after debounce', async () => {
    render(<Wrapper sessionId="s1" />);
    backend.emit('pty:output', {
      sessionId: 's1',
      events: [{ t: 'txt', p: '```ts\nconst x = 1;\n```' }],
    });
    await waitFor(() => {
      expect(useTerminalStore.getState().richOutputs.s1?.length).toBeGreaterThan(0);
    }, { timeout: 1000 });
    const item = useTerminalStore.getState().richOutputs.s1![0];
    expect(item.type).toBe('code');
    expect(item.language).toBe('ts');
  });

  it('ignores output for other sessions', async () => {
    render(<Wrapper sessionId="s1" />);
    backend.emit('pty:output', {
      sessionId: 's2',
      events: [{ t: 'txt', p: '$$x$$' }],
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(useTerminalStore.getState().richOutputs.s2).toBeFalsy();
  });
});
