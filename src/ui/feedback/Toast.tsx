import { create } from 'zustand';
import NotificationPortal from '@ui/feedback/NotificationPortal';
import NotificationCard from '@ui/feedback/NotificationCard';

type ToastType = 'info' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Display duration in ms; 0 = never auto-dismiss. */
  duration: number;
  /** Leaving (removed after the exit animation plays). */
  leaving?: boolean;
}

interface ToastState {
  toasts: ToastItem[];
  /** id → auto-dismiss timer. */
  timers: Record<number, ReturnType<typeof setTimeout>>;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: number) => void;
  /** Pause auto-dismiss while hovered. */
  pause: (id: number) => void;
  /** Restart the countdown after the pointer leaves. */
  resume: (id: number) => void;
}

let nextId = 1;

const DEFAULT_DURATION = 3000;
/** Exit animation duration (matches the toastOut keyframes). */
const LEAVE_MS = 200;

/** Marks a toast as leaving and removes it once the animation ends. */
function dismiss(set: (fn: (s: ToastState) => Partial<ToastState>) => void, id: number): void {
  // The auto-dismiss path also clears the timer map (otherwise a manual close or a hover
  // pause leaves an entry behind)
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
  // The exit timer is not tracked in timers (it takes no part in pause/resume)
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
    // Manual close: clear the timer, then play the exit animation
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

/** ToastContainer — bottom-right notifications (never covering the bottom input bar). */
export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <NotificationPortal followOwner={false}><div className="notification-toasts">
      {toasts.map((t) => <ToastItem key={t.id} t={t} />)}
    </div></NotificationPortal>
  );
}

function ToastItem({ t }: { t: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  return <NotificationCard role="status" tone={t.type} message={t.message} leaving={t.leaving} onDismiss={() => removeToast(t.id)} onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)} />;
}
