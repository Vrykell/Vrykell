import { useRef, useState } from 'react';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
import { IconBtn } from '@ui/actions/UiBtn';
import { Plus, Tag, X } from '@ui/icons';
import CheckboxMenu from '@ui/menus/CheckboxMenu';
import '@ui/fields/TagInput.css';

export default function TagInput({ value, options, onChange, inputTestId, limit = 12 }: {
  value: string[]; options: readonly { value: string; color: string }[]; onChange: (value: string[]) => void; inputTestId?: string; limit?: number;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    const tag = draft.trim();
    if (tag && value.length < limit && !value.includes(tag)) onChange([...value, tag]);
    setDraft(''); input.current?.focus();
  };
  const dot = (tag: string) => <i className="tag-input-dot" style={{ background: options.find(option => option.value === tag)?.color ?? 'var(--text-muted)' }} />;
  return <div className="tag-input">
    <div className="tag-input-field">
      {value.map(tag => <span key={tag} className="tag-input-chip">{dot(tag)}<span>{tag}</span><IconBtn title={t('Remove tag')} onClick={() => onChange(value.filter(item => item !== tag))}><X size={12} /></IconBtn></span>)}
      <TextInput ref={input} variant="field" aria-label={t('New tag')} placeholder={value.length ? '' : t('Add tags…')} value={draft} disabled={value.length >= limit}
        data-testid={inputTestId} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); add(); }
          if (event.key === 'Escape') { event.preventDefault(); setDraft(''); setOpen(false); }
        }} />
      {draft.trim() && <IconBtn title={t('Add tag')} disabled={value.length >= limit} onClick={add}><Plus size={14} /></IconBtn>}
      {!!options.length && <IconBtn ref={trigger} title={t('Existing tags')} aria-expanded={open} onClick={() => setOpen(current => !current)}><Tag size={14} /></IconBtn>}
    </div>
    {open && <CheckboxMenu title={t('Existing tags')} triggerRef={trigger} style={{ position: 'relative', width: '100%', minWidth: 0, maxHeight: 160, overflowY: 'auto', marginTop: 6, zIndex: 'auto' }}
      options={options.map(option => ({ id: option.value, label: option.value, checked: value.includes(option.value), icon: dot(option.value) }))}
      onToggle={tag => { if (value.includes(tag)) onChange(value.filter(item => item !== tag)); else if (value.length < limit) onChange([...value, tag]); }} onClose={() => setOpen(false)} />}
  </div>;
}
