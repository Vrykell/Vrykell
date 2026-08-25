/**
 * scrollbarHover — 滚动条区域悬停检测。
 *
 * 需求：滚动条默认完全隐藏，鼠标移动到「滚动条区域」时才显示。
 * 纯 CSS 无法只对滚动条本身做 hover 检测（Chromium 不支持
 * ::-webkit-scrollbar-thumb:hover），且侧栏面板边缘的拖拽手柄会拦截
 * 滚动条区域的鼠标事件。因此用坐标检测：mousemove 时判断鼠标是否落在
 * 某个可滚动容器的右缘/下缘（滚动条出现的位置），命中则给该容器打上
 * data-scrollbar-hover 标记，theme.css 据此显示滚动条。
 *
 * rAF 节流，避免高频 mousemove 里的 getComputedStyle 开销。
 */
const HIT = 8;

let raf = 0;
let lastX = 0;
let lastY = 0;
let installed = false;

function canScroll(node: HTMLElement): { v: boolean; h: boolean } {
  const st = getComputedStyle(node);
  const v =
    (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'overlay') &&
    node.scrollHeight > node.clientHeight + 1;
  const h =
    (st.overflowX === 'auto' || st.overflowX === 'scroll' || st.overflowX === 'overlay') &&
    node.scrollWidth > node.clientWidth + 1;
  return { v, h };
}

function check() {
  raf = 0;
  const el = document.elementFromPoint(lastX, lastY);
  let node: Element | null = el instanceof Element ? el : null;
  let hit: HTMLElement | null = null;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const { v, h } = canScroll(node);
      if (v || h) {
        const r = node.getBoundingClientRect();
        const inV = v && lastX >= r.right - HIT && lastX <= r.right && lastY >= r.top && lastY <= r.bottom;
        const inH = h && lastY >= r.bottom - HIT && lastY <= r.bottom && lastX >= r.left && lastX <= r.right;
        if (inV || inH) {
          hit = node;
          break;
        }
      }
    }
    node = node.parentElement;
  }
  // 全量清除旧标记，再打新标记（元素少，rAF 频率下开销可忽略）
  const marked = document.querySelectorAll('[data-scrollbar-hover]');
  for (const m of marked) {
    if (m !== hit) m.removeAttribute('data-scrollbar-hover');
  }
  if (hit && !hit.hasAttribute('data-scrollbar-hover')) {
    hit.setAttribute('data-scrollbar-hover', '');
  }
}

/** 安装全局滚动条区域悬停检测（应用启动时调用一次）。 */
export function installScrollbarHover(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('mousemove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(check);
  });
}
