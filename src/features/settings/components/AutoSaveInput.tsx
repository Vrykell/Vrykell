import { TextInput, TextArea } from '@ui/TextInput';
import { useRef, type CSSProperties, type HTMLInputTypeAttribute } from 'react';
import { useAutoSave } from '../hooks/useAutoSave';
import SaveStatus from './SaveStatus';
import { inputStyle } from './formStyles';
import { useSettingsSave } from './SettingsSaveProvider';

interface Props {
  value: string;
  onCommit: (value: string) => void | Promise<void>;
  placeholder?: string;
  style?: CSSProperties;
  multiline?: boolean;
  rows?: number;
  type?: HTMLInputTypeAttribute;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  trim?: boolean;
  validate?: (value: string) => string | undefined;
  normalize?: (value: string) => string;
  onClear?: () => Promise<void>;
  clearAfterSave?: boolean;
  /** Stable hook for tests; the visible copy may change. */
  testId?: string;
}

export default function AutoSaveInput({ value, onCommit, placeholder, style, multiline, rows, type, min, max, step, disabled, trim = true, validate, normalize, onClear, clearAfterSave, testId }: Props) {
  const composing = useRef(false);
  const { flex, flexShrink, width, minWidth, marginTop, marginBottom, ...controlStyle } = style ?? {};
  const validateDraft = validate ?? (type === 'number'
    ? (next: string) => next.trim() && Number.isFinite(Number(next)) ? undefined : '请输入有效数字'
    : undefined);
  const save = useAutoSave(value, onCommit, validateDraft, clearAfterSave ? '' : undefined, next => {
    let result = trim ? next.trim() : next;
    if (type === 'number') result = String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(result))));
    return normalize ? normalize(result) : result;
  });
  const feedback = useSettingsSave();
  const props = { value: save.value, placeholder, disabled, 'data-testid': testId,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => save.setValue(event.target.value, false, composing.current),
    onBlur: () => { void save.flush(); },
    onCompositionStart: () => { composing.current = true; save.setComposing(true); },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; save.setValue(event.currentTarget.value); save.setComposing(false); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void save.flush(); }
    },
    style: { ...inputStyle, ...controlStyle, width: '100%' },
  };
  return <div style={{ minWidth: minWidth ?? 0, flex, flexShrink, width, marginTop, marginBottom }}>
    {multiline ? <TextArea {...props} rows={rows} /> : <TextInput {...props} type={type} min={min} max={max} step={step} />}
    <SaveStatus status={save.status} error={save.error} onRetry={() => { void save.flush(); }} />
    {onClear && <button type="button" onClick={() => { void feedback.save(async () => {
      await save.cancel();
      await onClear();
      save.reset('');
    }); }} style={{ marginLeft: 8, padding: '2px 8px', fontSize: 'var(--fs-micro)' }}>清除</button>}
  </div>;
}
