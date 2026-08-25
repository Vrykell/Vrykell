import { create } from 'zustand';

type ToastType = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (message: string, type?: ToastType) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
}));

const COLORS: Record<ToastType, { bg: string; border: string }> = {
  info: { bg: 'var(--accent-bg)', border: 'var(--accent)' },
  success: { bg: 'var(--success-bg)', border: 'var(--success)' },
  error: { bg: 'var(--error-bg)', border: 'var(--error)' },
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 6,
      alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: '7px 18px', borderRadius: 8, fontSize: 12.5, letterSpacing: '0.01em',
          background: COLORS[t.type].bg,
          border: `1px solid ${COLORS[t.type].border}`,
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-md)',
          animation: 'toastIn 0.24s var(--ease)',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
