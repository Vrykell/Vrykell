import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { TextArea } from './TextInput';
import { IconButton } from './IconButton';
import { Check, Copy, iconSizes } from './icons';
import { writeClipboardText } from '@platform/clipboard';
import { t } from '@i18n';
import { useToastStore } from './Toast';

/** Editable configuration text with the same copy confirmation used by diagnostic details. */
export default function ConfigTextArea({ value, label, className = '', style, ...props }: ComponentPropsWithoutRef<'textarea'> & { label?: string }) {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const text = typeof value === 'string' ? value : String(value ?? props.defaultValue ?? '');
  const title = label;
  const name = label ?? props['aria-label'] ?? props.placeholder ?? t('Configuration text');
  const inputLabel = props['aria-label'] ?? label ?? props.placeholder ?? t('Configuration text');
  const copyLabel = copied ? t('Copied') : t('Copy {{name}}', { name });
  const copy = async () => {
    try {
      await writeClipboardText(text); setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { useToastStore.getState().addToast(t('Copy failed. Select the text to copy it manually.'), 'error'); }
  };
  return <>
    {title && <label htmlFor={inputId} className="config-text-area-label">{title}</label>}
    <div className="config-text-area" style={{ marginTop: style?.marginTop }}>
      <TextArea {...props} id={inputId} aria-label={inputLabel} value={value} className={`config-text-input ${className}`} style={style} />
      <IconButton compact className="config-text-area-copy" disabled={!text} aria-label={copyLabel} data-tip={copyLabel} onClick={() => void copy()}>
        {copied ? <Check size={iconSizes.compact} /> : <Copy size={iconSizes.compact} />}
      </IconButton>
    </div>
  </>;
}
