import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextArea } from './TextInput';
import InlineRenameInput from './InlineRenameInput';
import { OutlineButton } from './OutlineButton';
import { useExclusiveMenu } from './hooks/useExclusiveMenu';
import { useFloatingPanelPosition } from './hooks/useFloatingPanelPosition';
import type { MenuAnchor } from './ContextMenu';

/** Floating single-value editor used by history notes; Enter (or Ctrl+Enter in the text area) saves. */
export default function HistoryTextPrompt({ anchor, label, placeholder, value, multiline = false, allowEmpty = true, saveLabel, onSave, onClose, testId }: {
  anchor: MenuAnchor;
  label: string;
  placeholder: string;
  /** Initial text; saving an empty value removes the annotation. */
  value: string;
  multiline?: boolean;
  allowEmpty?: boolean;
  saveLabel: string;
  onSave: (text: string) => void;
  onClose: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value);
  useExclusiveMenu(ref, onClose);
  const close = () => { anchor.trigger?.focus(); onClose(); };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { anchor.trigger?.focus(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, anchor.trigger]);

  const width = 264;
  const position = useFloatingPanelPosition(ref, anchor);
  const save = () => {
    if (!allowEmpty && !text.trim()) return;
    onSave(text);
    close();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  };

  return createPortal(<div ref={ref} role="dialog" aria-label={label} data-testid={testId} className="workspace-floating history-text-prompt" style={{ ...position, width, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}>
    <div className="history-prompt-label">{label}</div>
    {multiline
      ? <TextArea autoFocus className="history-prompt-input" rows={3} aria-label={label} placeholder={placeholder}
        value={text} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} />
      : <InlineRenameInput autoFocus className="history-prompt-input" aria-label={label} placeholder={placeholder}
        value={text} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} />}
    <div className="history-prompt-actions">
      <OutlineButton className="history-prompt-action" data-testid={`${testId}-cancel`} onClick={close}>{t('Cancel')}</OutlineButton>
      <button type="button" className="history-prompt-action" data-primary disabled={!allowEmpty && !text.trim()} data-testid={`${testId}-save`} onClick={save}>{saveLabel}</button>
    </div>
  </div>, document.body);
}
