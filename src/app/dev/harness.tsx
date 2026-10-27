/**
 * harness.tsx — input-bar measurement comparison page (development only, not part of the app bundle).
 *
 * Renders two real components on one page and in one CSS context (theme.css):
 *   left: the terminal InputEditor (bound to the pane of the workspace's default session tab)
 *   right: PanelChat (dock panel shape, width 320)
 * After mount it measures the container / prompt row / input row / textarea height of
 * both input bars and writes the result into #result.
 *
 * Visit: http://localhost:1420/harness.html (driven by scripts/measure-input-bars.cjs)
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@app/theme.css';
import { applyTheme } from '@config/theme/tokens';
import { useTerminalStore } from '@features/terminal';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useChatStore } from '@features/chat';
import { firstLeaf } from '@features/workspace/model/windowLayout';
import InputEditor from '@features/terminal/components/InputEditor';
import PanelChat from '@features/chat/components/PanelChat';

applyTheme('dark');

// ── Minimal store state: the default session tab exists; add the pane session/scene/focus ──
const tab = useSessionStore.getState().tabs.find(isSessionTab);
if (!tab) throw new Error('harness: no session tab in initial workspace state');
const paneId = firstLeaf(tab.layout).id;
useTerminalStore.setState({
  sessions: { [paneId]: 'harness-fake-sid' },
  focusedPaneId: paneId,
  scenes: { [paneId]: 'blockList' },
});

// ── Global error capture (render crashes land here) ──
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String(e.reason).slice(0, 300)}`));
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errors.push(`console.error: ${args.map((a) => String(a)).join(' ').slice(0, 500)}`);
  origConsoleError(...args);
};

// ── Real streaming path: send + a fake streamFn that pushes characters, covering the dirty output a model typically streams ──
const STREAM_ANSWER = [
  '好的，这个问题分两步：\n\n',
  '1. 先运行 `$ make test` 确认失败用例，成本约 $5 ~ $10。\n',
  '2. 再看公式 $\\frac{a}{b}$ 与独立公式：\n\n$$E=mc^2$$\n\n',
  '```bash\nexport A=$HOME\ngrep -rn "foo_(bar)" ./src | head -5\n```\n\n',
  '| 列A | 列B |\n| --- | --- |\n| $5 | ~~旧~~ |\n\n',
  '参考 www.example.com/path?q=1_(2) 与 https://zh.wikipedia.org/wiki/测试_(消歧义)。\n\n',
  '> 注意：`C:\\Users\\test\\$HOME` 里的反斜杠。完成度 $100\\%$。\n',
].join('');

function startStreamSimulation() {
  const streamFn = async (_msgs: Array<{ role: string; content: string }>, onChunk: (t: string) => void) => {
    let i = 0;
    while (i < STREAM_ANSWER.length) {
      const n = 1 + Math.floor(Math.random() * 3); // random 1–3 character slices to create dirty intermediate states
      onChunk(STREAM_ANSWER.slice(i, i + n));
      i += n;
      await new Promise((r) => setTimeout(r, 8));
    }
  };
  void useChatStore.getState().send('为什么构建失败？', { paneId, streamFn });
}

// ── Measurement: textarea → input row → container (both components have the same DOM depth) ──
function measure(slotId: string) {
  const slot = document.getElementById(slotId);
  if (!slot) return { error: `slot ${slotId} missing` };
  const ta = slot.querySelector('textarea');
  if (!ta) return { error: `slot ${slotId} has no textarea` };
  const inputRow = ta.parentElement as HTMLElement;
  const container = inputRow.parentElement as HTMLElement;
  const promptRow = container.children[0] as HTMLElement;
  const h = (el: Element) => Math.round(el.getBoundingClientRect().height * 100) / 100;
  const cs = getComputedStyle(container);
  return {
    container: h(container),
    promptRow: h(promptRow),
    inputRow: h(inputRow),
    textarea: h(ta),
    containerPadding: cs.padding,
    containerBorderTop: cs.borderTopWidth,
  };
}

function publish() {
  const fallbackEls = document.querySelectorAll('#panel-slot .md span, #panel-slot span');
  const fallbackHit = Array.from(fallbackEls).some((el) => el.textContent?.includes('无法渲染此消息'));
  const out = {
    dpr: window.devicePixelRatio,
    term: measure('term-slot'),
    panel: measure('panel-slot'),
    streamRenderedText: document.querySelector('#panel-slot .md')?.textContent?.slice(0, 120) ?? null,
    fallbackVisible: fallbackHit,
    errors,
  };
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = JSON.stringify(out, null, 2);
  document.body.appendChild(pre);
}

function Harness() {
  return (
    <div style={{ display: 'flex', gap: 40, padding: 20, height: '100%', background: 'var(--canvas)' }}>
      {/* Terminal side: simulates the bottom of a pane (700px wide) */}
      <div style={{ width: 700, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'var(--surface)' }}>
        <div id="term-slot">
          <InputEditor paneId={paneId} focused />
        </div>
      </div>
      {/* Panel side: simulates a dock panel (320px wide, fixed height) */}
      <div style={{ width: 320, background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
        <div id="panel-slot" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PanelChat />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// Publish measurements after all simulated streams finish.
setTimeout(startStreamSimulation, 300);
const poll = setInterval(() => {
  const s = useChatStore.getState();
  const msgs = s.byTab[tab.id] ?? [];
  if (msgs.length > 0 && s.sendingTabs.length === 0) {
    clearInterval(poll);
    setTimeout(publish, 400); // wait for the last frame to paint
  }
}, 300);
setTimeout(() => { clearInterval(poll); publish(); }, 30000); // safety timeout
