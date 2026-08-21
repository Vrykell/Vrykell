/**
 * harness.tsx — 输入栏度量对比页（仅开发用，不进应用 bundle）。
 *
 * 在同一页面、同一 CSS 上下文（theme.css）里渲染两个真实组件：
 *   左：终端 InputEditor（绑定到 workspace 默认 session tab 的 pane）
 *   右：PanelChat（dock 面板形态，宽度 320）
 * 挂载后测量两条输入栏的容器/prompt 行/输入行/textarea 高度，写入 #result。
 *
 * 访问：http://localhost:1420/harness.html（由 scripts/measure-input-bars.cjs 驱动）
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import { useTerminalStore } from '../stores/terminal';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { firstLeaf } from '../lib/windowLayout';
import InputEditor from '../terminal/InputEditor';
import PanelChat from '../chat/PanelChat';

// ── 最小 store 状态：默认 session tab 已存在，补上 pane 会话/场景/聚焦 ──
const tab = useWorkspaceStore.getState().tabs.find(isSessionTab);
if (!tab) throw new Error('harness: no session tab in initial workspace state');
const paneId = firstLeaf(tab.layout).id;
useTerminalStore.setState({
  sessions: { [paneId]: 'harness-fake-sid' },
  focusedPaneId: paneId,
  scenes: { [paneId]: 'blockList' },
});

// ── 测量：textarea → 输入行 → 容器（两个组件的 DOM 深度一致） ──
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
  const out = {
    dpr: window.devicePixelRatio,
    term: measure('term-slot'),
    panel: measure('panel-slot'),
  };
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = JSON.stringify(out, null, 2);
  document.body.appendChild(pre);
}

function Harness() {
  return (
    <div style={{ display: 'flex', gap: 40, padding: 20, height: '100%', background: 'var(--canvas)' }}>
      {/* 终端侧：模拟 pane 底部（700px 宽） */}
      <div style={{ width: 700, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'var(--surface)' }}>
        <div id="term-slot">
          <InputEditor paneId={paneId} focused />
        </div>
      </div>
      {/* 面板侧：模拟 dock 面板（320px 宽，固定高度） */}
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

setTimeout(publish, 800);
