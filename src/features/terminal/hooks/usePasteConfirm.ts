import { settlePasteConfirm, usePasteConfirmStore } from '@features/terminal/stores/pasteConfirm';

/**
 * The pending paste question plus its two answers. Views go through this hook instead of the store,
 * which keeps the store access inside the feature's hooks layer.
 */
export function usePasteConfirm() {
  const request = usePasteConfirmStore((state) => state.request);
  return {
    request,
    confirm: () => settlePasteConfirm(true),
    cancel: () => settlePasteConfirm(false),
  };
}
