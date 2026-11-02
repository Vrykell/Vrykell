import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import NotificationPortal from '@ui/feedback/NotificationPortal';
import NotificationCard from '@ui/feedback/NotificationCard';

type ToastType = 'info' | 'success' | 'error' | 'warning';
type PauseReason = 'pointer' | 'focus' | 'background';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Display duration in ms; 0 = never auto-dismiss. */
  duration: number;
  remaining: number;
  startedAt?: number;
  paused: PauseReason[];
  /** Leaving (removed after the exit animation plays). */
  leaving?: boolean;
}

interface ToastState {
  toasts: ToastItem[];
  /** id → auto-dismiss timer. */
  timers: Record<number, ReturnType<typeof setTimeout>>;
  background: boolean;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: number) => void;
  pause: (id: number, reason?: PauseReason) => void;
  resume: (id: number, reason?: PauseReason) => void;
  setBackground: (background: boolean) => void;
}

let nextId = 1;

const DEFAULT_DURATION: Record<ToastType, number> = { success: 3000, info: 4000, warning: 6000, error: 8000 };
/** Exit animation duration (matches the toastOut keyframes). */
const LEAVE_MS = 200;

/** Marks a toast as leaving and removes it once the animation ends. */
function dismiss(id: number): void {
  const state = useToastStore.getState();
  if (!state.toasts.some(item => item.id === id && !item.leaving)) return;
  const timer = state.timers[id];
  if (timer) clearTimeout(timer);
  useToastStore.setState((s) => {
    const timers = { ...s.timers };
    delete timers[id];
    return { toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)), timers };
  });
  setTimeout(() => {
    useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, LEAVE_MS);
}

function startTimer(id: number): void {
  const state = useToastStore.getState();
  const item = state.toasts.find(toast => toast.id === id);
  if (!item || item.leaving || item.duration <= 0 || item.paused.length || state.background || state.timers[id]) return;
  const timer = setTimeout(() => dismiss(id), item.remaining);
  useToastStore.setState(s => ({ timers: { ...s.timers, [id]: timer }, toasts: s.toasts.map(toast => toast.id === id ? { ...toast, startedAt: Date.now() } : toast) }));
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  timers: {},
  background: false,

  addToast: (message, type = 'info', duration) => {
    const id = nextId++;
    const timeout = Math.max(0, duration ?? Math.min(12000, Math.max(DEFAULT_DURATION[type], message.length * 65)));
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration: timeout, remaining: timeout, paused: s.background ? ['background'] : [] }] }));
    startTimer(id);
  },

  removeToast: dismiss,

  pause: (id, reason = 'pointer') => {
    const item = get().toasts.find(toast => toast.id === id);
    if (!item || item.leaving || item.duration <= 0 || item.paused.includes(reason)) return;
    clearTimeout(get().timers[id]);
    const remaining = Math.max(0, item.remaining - (item.startedAt === undefined ? 0 : Math.max(0, Date.now() - item.startedAt)));
    set((s) => {
      const timers = { ...s.timers };
      delete timers[id];
      return { timers, toasts: s.toasts.map(toast => toast.id === id ? { ...toast, remaining, startedAt: undefined, paused: [...toast.paused, reason] } : toast) };
    });
  },

  resume: (id, reason = 'pointer') => {
    const item = get().toasts.find(toast => toast.id === id);
    if (!item || item.leaving || !item.paused.includes(reason)) return;
    set(s => ({ toasts: s.toasts.map(toast => toast.id === id ? { ...toast, paused: toast.paused.filter(value => value !== reason) } : toast) }));
    startTimer(id);
  },
  setBackground: background => {
    set({ background });
    for (const item of get().toasts) {
      if (background) get().pause(item.id, 'background');
      else get().resume(item.id, 'background');
    }
  },
}));

/** Transient notifications retain their remaining reading time across background changes. */
export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  useEffect(() => {
    const sync = () => useToastStore.getState().setBackground(document.hidden || !document.hasFocus());
    const blur = () => useToastStore.getState().setBackground(true);
    const focus = () => useToastStore.getState().setBackground(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => { document.removeEventListener('visibilitychange', sync); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, []);
  if (toasts.length === 0) return null;

  return (
    <NotificationPortal followOwner={false}><div className="notification-toasts">
      {toasts.map((t) => <ToastItem key={t.id} t={t} />)}
    </div></NotificationPortal>
  );
}

function ToastItem({ t }: { t: ToastItem }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const removeToast = useToastStore((s) => s.removeToast);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  const dismiss = () => { removeToast(t.id); if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  return <NotificationCard role="status" tone={t.type} message={t.message} leaving={t.leaving} onDismiss={dismiss}
    onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)}
    onFocusCapture={event => {
      if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget;
      pause(t.id, 'focus');
    }} onBlurCapture={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) resume(t.id, 'focus');
    }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }} />;
}
