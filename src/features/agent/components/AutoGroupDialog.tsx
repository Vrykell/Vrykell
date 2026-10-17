import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import ToolWindow from '@ui/ToolWindow';
import { OutlineButton } from '@ui/OutlineButton';
import { TextButton } from '@ui/TextButton';
import ErrorBox from '@ui/ErrorBox';
import { GROUPING_LIMIT, suggestGrouping, type GroupingItem, type GroupingProposal } from '../services/autoGrouping';

export default function AutoGroupDialog({ items, kind, onApply, onClose }: {
  items: GroupingItem[]; kind: string; onApply: (groups: GroupingProposal[]) => Promise<void>; onClose: () => void;
}) {
  const [snapshot] = useState(() => items.slice(0, GROUPING_LIMIT));
  const [groups, setGroups] = useState<GroupingProposal[] | null>(null);
  const [busy, setBusy] = useState(false); const [applying, setApplying] = useState(false); const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (applied && !applying) onClose(); }, [applied, applying, onClose]);
  const generate = async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setGroups(null);
    try { const result = await suggestGrouping(snapshot, kind, request.signal); if (!request.signal.aborted) setGroups(result); }
    catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  return <ToolWindow label={t('AI auto-group')} busy={applying} onClose={onClose} onBeforeClose={() => controller.current?.abort()} footer={
    <div className="auto-group-actions">
      <OutlineButton disabled={busy || applying || !snapshot.length} onClick={() => void generate()}>{t(groups ? 'Regenerate groups' : 'Suggest groups')}</OutlineButton>
      {busy && <TextButton onClick={() => { controller.current?.abort(); setBusy(false); }}>{t('Cancel')}</TextButton>}
      <TextButton className="user-primary-action" disabled={!groups || busy || applying} onClick={() => {
        if (!groups || applying) return; setApplying(true); setError('');
        void onApply(groups).then(() => setApplied(true)).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setApplying(false));
      }}>{t(applying ? 'Applying…' : 'Apply grouping')}</TextButton>
    </div>}>
    <div className="auto-group-dialog">
      <p>{t('AI suggests groups for {{count}} items. Review the plan before applying; items are never executed or deleted.', { count: snapshot.length })}</p>
      {items.length > GROUPING_LIMIT && <p>{t('Only the first {{count}} items are included.', { count: GROUPING_LIMIT })}</p>}
      {error && <ErrorBox title={t('Could not group items')}>{error}</ErrorBox>}
      {busy && <p role="status">{t('Organizing items…')}</p>}
      {groups && <div className="auto-group-preview" aria-label={t('Grouping preview')}>{groups.map((group, index) => <section key={index}>
        <h3>{group.name} <span>{group.itemIds.length}</span></h3>
        <ul>{group.itemIds.map(id => <li key={id} data-tip={snapshot.find(item => item.id === id)?.detail}>{snapshot.find(item => item.id === id)?.label}</li>)}</ul>
      </section>)}</div>}
      <p>{t('Items outside the proposal keep their existing groups.')}</p>
    </div>
  </ToolWindow>;
}
