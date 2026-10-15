import { create } from 'zustand';
import type { SshAuthenticationTarget } from '@core/ssh';

interface State {
  request: (SshAuthenticationTarget & { requestId: number }) | null;
  revisions: Record<string, number>;
  temporary: Record<string, boolean>;
}

// This store contains only request metadata. Secrets stay in the dialog until submission.
export const useSessionAuthenticationStore = create<State>(() => ({ request: null, revisions: {}, temporary: {} }));
let sequence = 0;

export function requestSshAuthentication(target: SshAuthenticationTarget) {
  if (useSessionAuthenticationStore.getState().request) return;
  useSessionAuthenticationStore.setState({ request: { ...target, requestId: ++sequence } });
}

export function finishSshAuthentication(requestId: number) {
  useSessionAuthenticationStore.setState(state => {
    if (state.request?.requestId !== requestId) return state;
    const id = state.request.connectionId;
    return { request: null, revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 }, temporary: { ...state.temporary, [id]: true } };
  });
}

export function clearSshAuthenticationMetadata(id: string) {
  useSessionAuthenticationStore.setState(state => ({
    request: state.request?.connectionId === id ? null : state.request,
    revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 },
    temporary: { ...state.temporary, [id]: false },
  }));
}
