import { useState } from 'react';
import Select from '@ui/Select';
import ErrorBox from '@ui/ErrorBox';
import { TextInput } from '@ui/TextInput';
import ConfigTextArea from '@ui/ConfigTextArea';
import { IconButton } from '@ui/IconButton';
import { Plus, Trash2 } from '@ui/icons';
import { TextButton } from '@ui/TextButton';
import { t } from '@i18n';
import { formatForwardRules, parseForwardTexts, type ForwardKind, type ForwardRule, type ForwardTexts } from '../model/forwardRules';

interface Props { value: ForwardTexts; onChange: (next: ForwardTexts) => void }
const types = () => [
  { value: 'local', label: t('Local forward') }, { value: 'remote', label: t('Remote forward') }, { value: 'dynamic', label: t('Dynamic forward') },
] as const;

/** Both editors share the same profile strings; switching never drops an unsupported draft. */
export default function SshForwardingEditor({ value, onChange }: Props) {
  const initial = parseForwardTexts(value);
  const [mode, setMode] = useState<'gui' | 'text'>(initial ? 'gui' : 'text');
  const [rows, setRows] = useState<ForwardRule[]>(initial ?? []);
  const [error, setError] = useState('');
  const switchMode = (next: 'gui' | 'text') => {
    if (next === 'gui') {
      const parsed = parseForwardTexts(value);
      if (!parsed) { setError(t('Fix the forwarding syntax before switching to the visual editor.')); return; }
      setRows(parsed);
    }
    setError(''); setMode(next);
  };
  const update = (next: ForwardRule[]) => { setRows(next); onChange(formatForwardRules(next)); };
  const changeRow = (id: string, changes: Partial<ForwardRule>) => update(rows.map(row => row.id === id ? { ...row, ...changes } : row));
  const add = () => update([...rows, { id: crypto.randomUUID(), kind: 'local', bind: '', port: '', host: 'localhost', targetPort: '' }]);
  return <div className="ssh-forwarding-editor">
    <div className="ssh-section-heading">
      <div><h3>{t('Port forwarding')}</h3><p>{t('Map a listening port to a destination, or create a SOCKS proxy.')}</p></div>
      <Select aria-label={t('Forwarding editor')} value={mode} onChange={switchMode} options={[{ value: 'gui', label: t('Visual editor') }, { value: 'text', label: t('Text mode') }]} />
    </div>
    {error && <ErrorBox compact tone="error">{error}</ErrorBox>}
    {mode === 'gui' ? <>
      {rows.map((row, index) => <div key={row.id} className="ssh-forward-rule" data-testid={`ssh-forward-rule-${index}`}>
        <div className="ssh-forward-rule-heading">
          <Select aria-label={t('Forward type')} value={row.kind} options={types()} onChange={kind => changeRow(row.id, { kind: kind as ForwardKind })} />
          <span>{t(row.kind === 'local' ? 'This computer → remote destination' : row.kind === 'remote' ? 'Remote computer → local destination' : 'SOCKS proxy on this computer')}</span>
          <IconButton tone="danger" aria-label={t('Remove forwarding rule')} data-tip={t('Remove forwarding rule')} onClick={() => update(rows.filter(item => item.id !== row.id))}><Trash2 size={14} /></IconButton>
        </div>
        <div className="ssh-forward-fields">
          <label>{t('Listen address')}<TextInput variant="field" value={row.bind} placeholder="127.0.0.1" onChange={e => changeRow(row.id, { bind: e.target.value })} /></label>
          <label>{t('Listen port')}<TextInput variant="field" inputMode="numeric" value={row.port} placeholder="8080" data-testid={`ssh-forward-port-${index}`} onChange={e => changeRow(row.id, { port: e.target.value })} /></label>
          {row.kind !== 'dynamic' && <>
            <label>{t('Destination host')}<TextInput variant="field" value={row.host} data-testid={`ssh-forward-host-${index}`} onChange={e => changeRow(row.id, { host: e.target.value })} /></label>
            <label>{t('Destination port')}<TextInput variant="field" inputMode="numeric" value={row.targetPort} placeholder="80" data-testid={`ssh-forward-target-port-${index}`} onChange={e => changeRow(row.id, { targetPort: e.target.value })} /></label>
          </>}
        </div>
      </div>)}
      <TextButton className="ssh-editor-link" onClick={add} data-testid="ssh-forward-add"><Plus size={14} />{t('Add forwarding rule')}</TextButton>
    </> : <div className="ssh-forward-texts">
      {(['local', 'remote', 'dynamic'] as const).map(kind => <ConfigTextArea key={kind} label={t(kind === 'local' ? 'Local forward' : kind === 'remote' ? 'Remote forward' : 'Dynamic forward')}
        aria-label={t(kind === 'local' ? 'Local forward' : kind === 'remote' ? 'Remote forward' : 'Dynamic forward')}
        data-testid={`ssh-form-${kind}-forward`} rows={3} value={value[kind]} placeholder={kind === 'dynamic' ? '1080' : '8080:localhost:80'} onChange={e => onChange({ ...value, [kind]: e.target.value })} />)}
      <p className="ssh-hint">{t('One rule per line. Static: [bind:]port:host:port. SOCKS: [bind:]port.')}</p>
    </div>}
  </div>;
}
