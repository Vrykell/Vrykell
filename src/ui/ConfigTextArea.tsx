import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { TextArea } from './TextInput';
import { IconButton } from './IconButton';
import { Check, Copy } from './icons';
import { writeClipboardText } from '@platform/clipboard';
import { t } from '@i18n';
import { useToastStore } from './Toast';

/** Editable configuration text with the same copy confirmation used by diagnostic details. */
export default function ConfigTextArea({ value, label, className = '', style, ...props }: ComponentPropsWithoutRef<'textarea'> & { label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const text = typeof value === 'string' ? value : String(value ?? props.defaultValue ?? '');
  const title = label ?? props['aria-label'] ?? t('Configuration text');
  const copyLabel = copied ? t('Copied') : t('Copy {{name}}', { name: title });
  const copy = async () => {
    try {
      await writeClipboardText(text); setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { useToastStore.getState().addToast(t('Copy failed. Select the text to copy it manually.'), 'error'); }
  };
  return <div className="config-text-area" style={{ marginTop: style?.marginTop }}>
    <div className="config-text-area-header">
      <span>{title}</span>
      <IconButton compact disabled={!text} aria-label={copyLabel} data-tip={copyLabel} onClick={() => void copy()}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
    </div>
    <TextArea {...props} aria-label={props['aria-label'] ?? label ?? t('Configuration text')} value={value} className={`config-text-input ${className}`} style={style} />
  </div>;
}
