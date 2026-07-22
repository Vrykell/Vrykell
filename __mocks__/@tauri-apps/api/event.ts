import type { EventCallback, Event, UnlistenFn } from '@tauri-apps/api/event';

export async function listen<T>(
  event: string,
  cb: EventCallback<T>,
): Promise<UnlistenFn> {
  const backend = (globalThis as any).__FAKE_TAURI_BACKEND__;
  return backend.listen(event, (payload: T) => {
    cb({ event, id: 0, payload } as Event<T>);
  });
}
