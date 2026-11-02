import { create } from 'zustand';
import { interceptEditorClose } from '@core/editor';
import { t } from '@i18n';
import { applicationVersion, checkApplicationUpdate, prepareApplicationUpdate, restartApplication, type AppUpdate } from '@platform/updater';

type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'restarting' | 'installed';
type Operation = 'check' | 'download' | 'install' | 'restart';
interface UpdateState {
  currentVersion: string;
  phase: Phase;
  version: string;
  notes: string;
  downloaded: number;
  total?: number;
  error: string;
  operation: Operation;
  loadVersion: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => void;
  clearError: () => void;
}

let pending: AppUpdate | null = null;
const busy = (phase: Phase) => ['checking', 'downloading', 'installing', 'restarting'].includes(phase);

/** Keep the native update resource alive when settings navigation changes. */
export const useAppUpdate = create<UpdateState>((set, get) => ({
  currentVersion: '', phase: 'idle', version: '', notes: '', downloaded: 0, error: '', operation: 'check',
  loadVersion: async () => {
    if (get().currentVersion) return;
    try { set({ currentVersion: await applicationVersion() }); }
    catch (error) { set({ error: String(error), operation: 'check' }); }
  },
  clearError: () => set({ error: '' }),
  check: async () => {
    if (busy(get().phase) || get().phase === 'installed') return;
    set({ phase: 'checking', error: '', operation: 'check', version: '', notes: '', downloaded: 0, total: undefined });
    const previous = pending; pending = null;
    await previous?.close().catch(() => {});
    try {
      const update = await checkApplicationUpdate();
      if (update && !/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(update.version)) {
        await update.close();
        throw new Error(t('Only stable releases can be installed.'));
      }
      pending = update;
      set({ phase: update ? 'available' : 'current', version: update?.version ?? '', notes: update?.body?.slice(0, 20000) ?? '', downloaded: 0, total: undefined });
    } catch (error) { set({ phase: 'idle', error: String(error) }); }
  },
  download: async () => {
    const update = pending;
    if (!update || get().phase !== 'available') return;
    set({ phase: 'downloading', error: '', operation: 'download', downloaded: 0, total: undefined });
    try {
      await update.download(event => {
        if (pending !== update || get().phase !== 'downloading') return;
        if (event.event === 'Started') set({ total: event.data.contentLength });
        if (event.event === 'Progress') set(state => ({ downloaded: state.downloaded + event.data.chunkLength }));
      }, { timeout: 120000 });
      // Completion is published only after the native signature verification succeeds.
      set({ phase: 'ready' });
    } catch (error) { set({ phase: 'available', error: String(error) }); }
  },
  install: () => {
    const update = pending;
    const phase = get().phase;
    if (!update || (phase !== 'ready' && phase !== 'installed')) return;
    const proceed = () => {
      if (pending !== update || get().phase !== phase) return;
      set({ phase: 'installing', error: '', operation: phase === 'installed' ? 'restart' : 'install' });
      void (async () => {
        try {
          await prepareApplicationUpdate();
          if (phase === 'ready') await update.install({ restartAfterInstall: true });
        } catch (error) { set({ phase, error: String(error) }); return; }
        set({ phase: 'restarting', operation: 'restart' });
        try { await restartApplication(); set({ phase: 'installed' }); }
        catch (error) { set({ phase: 'installed', error: String(error) }); }
      })();
    };
    if (!interceptEditorClose('all', proceed)) proceed();
  },
}));
