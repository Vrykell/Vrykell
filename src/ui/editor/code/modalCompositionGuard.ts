interface TextAreaSnapshot {
  value: string;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}

/**
 * Keeps native composition input out of the editor while modal editing is not accepting text.
 *
 * Composition events are delivered to the hidden text area before the editor input layer handles
 * them, so a committed composition would otherwise edit the buffer from normal mode. Events are
 * stopped on the host during the capture phase, and the text area is restored afterwards so the
 * next insertion does not replay the discarded preedit.
 */
export function guardModalComposition(host: HTMLElement, acceptsText: () => boolean): () => void {
  let blocked = false;
  let textarea: HTMLTextAreaElement | null = null;
  let snapshot: TextAreaSnapshot | null = null;
  const blockedEvents = ['compositionupdate', 'compositionend', 'beforeinput', 'input'] as const;

  const restore = () => {
    if (!textarea || !snapshot) return;
    textarea.value = snapshot.value;
    textarea.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
    textarea = null;
    snapshot = null;
  };

  const stop = (event: Event) => {
    event.stopPropagation();
  };
  const stopAndPrevent = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onCompositionStart = (event: Event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    if (acceptsText()) {
      if (blocked) restore();
      blocked = false;
      textarea = null;
      snapshot = null;
      return;
    }
    blocked = true;
    textarea = event.target;
    snapshot = {
      value: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection,
    };
    stop(event);
  };

  const onBlockedInput = (event: Event) => {
    if (!blocked || event.target !== textarea) return;
    stopAndPrevent(event);
    if (event.type === 'compositionend') {
      blocked = false;
      restore();
    }
  };

  const onBlur = () => {
    if (!blocked) return;
    blocked = false;
    restore();
  };

  host.addEventListener('compositionstart', onCompositionStart, true);
  host.addEventListener('blur', onBlur, true);
  for (const type of blockedEvents) host.addEventListener(type, onBlockedInput, true);

  return () => {
    host.removeEventListener('compositionstart', onCompositionStart, true);
    host.removeEventListener('blur', onBlur, true);
    for (const type of blockedEvents) host.removeEventListener(type, onBlockedInput, true);
    if (blocked) restore();
    blocked = false;
    textarea = null;
    snapshot = null;
  };
}
