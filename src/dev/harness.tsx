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
import '@/theme.css';
import PanelChat from '@/chat/PanelChat';
import { firstLeaf } from '@/lib/windowLayout';
import { useChatStore } from '@/stores/chat';
import { useTerminalStore } from '@/stores/terminal';
import { isSessionTab, useWorkspaceStore } from '@/stores/workspace';
import InputEditor from '@/terminal/InputEditor';

// ── 最小 store 状态：默认 session tab 已存在，补上 pane 会话/场景/聚焦 ──
const tab = useWorkspaceStore.getState().tabs.find(isSessionTab);
if (!tab) throw new Error('harness: no session tab in initial workspace state');
const paneId = firstLeaf(tab.layout).id;
useTerminalStore.setState({
  sessions: { [paneId]: 'harness-fake-sid' },
  focusedPaneId: paneId,
  scenes: { [paneId]: 'blockList' },
});

// ── 全局错误捕获（渲染崩溃会落到这里） ──
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  errors.push(`rejection: ${String(e.reason).slice(0, 300)}`),
);
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errors.push(
    `console.error: ${args
      .map((a) => String(a))
      .join(' ')
      .slice(0, 500)}`,
  );
  origConsoleError(...args);
};

// ── 真实流式路径：send + 伪 streamFn 逐字符推流，内容覆盖 LLM 常见脏输出 ──
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
  const streamFn = async (
    _msgs: Array<{ role: string; content: string }>,
    onChunk: (t: string) => void,
  ) => {
    let i = 0;
    while (i < STREAM_ANSWER.length) {
      const n = 1 + Math.floor(Math.random() * 3); // 1~3 字符随机切片，制造脏中间态
      onChunk(STREAM_ANSWER.slice(i, i + n));
      i += n;
      await new Promise((r) => setTimeout(r, 8));
    }
  };
  void useChatStore.getState().send('为什么构建失败？', { paneId, streamFn });
}

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
  const fallbackEls = document.querySelectorAll('#panel-slot .md span, #panel-slot span');
  const fallbackHit = Array.from(fallbackEls).some((el) =>
    el.textContent?.includes('无法渲染此消息'),
  );
  const out = {
    dpr: window.devicePixelRatio,
    term: measure('term-slot'),
    panel: measure('panel-slot'),
    streamRenderedText:
      document.querySelector('#panel-slot .md')?.textContent?.slice(0, 120) ?? null,
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
    <div
      style={{ display: 'flex', gap: 40, padding: 20, height: '100%', background: 'var(--canvas)' }}
    >
      {/* 终端侧：模拟 pane 底部（700px 宽） */}
      <div
        style={{
          width: 700,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: 'var(--surface)',
        }}
      >
        <div id="term-slot">
          <InputEditor paneId={paneId} focused />
        </div>
      </div>
      {/* 面板侧：模拟 dock 面板（320px 宽，固定高度） */}
      <div
        style={{ width: 320, background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
      >
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

// 启动流式模拟；流结束后（sendingTab 复位）再发布测量结果
setTimeout(startStreamSimulation, 300);
const poll = setInterval(() => {
  const s = useChatStore.getState();
  const msgs = s.byTab[tab.id] ?? [];
  if (msgs.length > 0 && s.sendingTab === null) {
    clearInterval(poll);
    setTimeout(publish, 400); // 等最后一帧渲染落地
  }
}, 300);
setTimeout(() => {
  clearInterval(poll);
  publish();
}, 30000); // 兜底
