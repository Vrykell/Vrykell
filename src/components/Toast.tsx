import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { create } from 'zustand';
import s from './Toast.module.css';

type ToastType = 'info' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** 展示时长 ms；0 = 不自动消失 */
  duration: number;
  /** 退场中（播放 toastOut 动画后移除） */
  leaving?: boolean;
}

interface ToastState {
  toasts: ToastItem[];
  /** id → 自动消失计时器 */
  timers: Record<number, ReturnType<typeof setTimeout>>;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: number) => void;
  /** 悬停暂停自动消失 */
  pause: (id: number) => void;
  /** 离开后重新计时 */
  resume: (id: number) => void;
}

let nextId = 1;

const DEFAULT_DURATION = 3000;
/** 退场动画时长（与 toastOut keyframe 一致） */
const LEAVE_MS = 200;

/** 把 toast 标记为退场，动画结束后真正移除。 */
function dismiss(set: (fn: (s: ToastState) => Partial<ToastState>) => void, id: number): void {
  // 自动消失路径也要清计时器表（否则手动关闭/悬停暂停后残留）
  const timer = useToastStore.getState().timers[id];
  if (timer) clearTimeout(timer);
  set((s) => {
    const timers = { ...s.timers };
    delete timers[id];
    return { toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)), timers };
  });
  const leaveTimer = setTimeout(() => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, LEAVE_MS);
  // 退场计时器不挂进 timers（不参与暂停/恢复）
  void leaveTimer;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  timers: {},

  addToast: (message, type = 'info', duration = DEFAULT_DURATION) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    if (duration > 0) {
      const timer = setTimeout(() => dismiss(set, id), duration);
      set((s) => ({ timers: { ...s.timers, [id]: timer } }));
    }
  },

  removeToast: (id) => {
    // 手动关闭：清除计时器后播放退场动画
    const timer = useToastStore.getState().timers[id];
    if (timer) clearTimeout(timer);
    set((s) => {
      const timers = { ...s.timers };
      delete timers[id];
      return { timers };
    });
    dismiss(set, id);
  },

  pause: (id) => {
    const timer = useToastStore.getState().timers[id];
    if (!timer) return;
    clearTimeout(timer);
    set((s) => {
      const timers = { ...s.timers };
      delete timers[id];
      return { timers };
    });
  },

  resume: (id) => {
    const item = useToastStore.getState().toasts.find((t) => t.id === id);
    if (!item || item.duration <= 0) return;
    const timer = setTimeout(() => dismiss(set, id), item.duration);
    set((s) => ({ timers: { ...s.timers, [id]: timer } }));
  },
}));

const ICONS: Record<ToastType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
};

const COLORS: Record<ToastType, string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
};

/** ToastContainer — 右下角消息通知（不遮底部输入栏）。 */
export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className={s.container}>
      {toasts.map((t) => (
        <ToastItemComp key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastItemComp({ t }: { t: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  const Icon = ICONS[t.type];
  const color = COLORS[t.type];

  return (
    <div
      onMouseEnter={() => pause(t.id)}
      onMouseLeave={() => resume(t.id)}
      role="status"
      className={t.leaving ? `${s.item} ${s.itemExit}` : `${s.item} ${s.itemEnter}`}
    >
      {/* 左侧类型色强调条 */}
      <span className={s.colorBar} style={{ background: color }} />
      <Icon size={15} className={s.icon} style={{ color }} />
      <span className={s.message}>{t.message}</span>
      <button
        onClick={() => removeToast(t.id)}
        title="关闭"
        aria-label="关闭通知"
        className={s.closeBtn}
      >
        <X size={13} />
      </button>
    </div>
  );
}
