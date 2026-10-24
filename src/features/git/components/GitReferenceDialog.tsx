import { useEffect, useState } from 'react';
import type { GitReference, GitReferenceAction, GitSnapshot, GitTarget } from '@core/git';
import { editGitReference, getGitReferences } from '@platform/api/git';
import { gitTargetKey, useGitOperations } from '../stores/operations';
import ToolDialog from '@ui/feedback/ToolDialog';
import Select from '@ui/fields/Select';
import { TextInput } from '@ui/fields/TextInput';
import ConfigTextArea from '@ui/fields/ConfigTextArea';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { t } from '@i18n';

export const referenceActionLabel = (action: GitReferenceAction) => t({ switchBranch: 'Switch branch', createBranch: 'Create branch', renameBranch: 'Rename branch', deleteBranch: 'Delete branch', merge: 'Merge branch', rebase: 'Rebase branch',
  abortMerge: 'Abort merge', abortRebase: 'Abort rebase', continueRebase: 'Continue rebase', createTag: 'Create tag', deleteTag: 'Delete tag' }[action]);

export default function GitReferenceDialog({ target, snapshot, action, onClose, refresh }: {
  target: GitTarget; snapshot: GitSnapshot; action: GitReferenceAction; onClose: () => void; refresh: () => void;
}) {
  const [refs, setRefs] = useState<GitReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [start, setStart] = useState('HEAD');
  const [error, setError] = useState('');
  const key = gitTargetKey(target);
  const busy = useGitOperations(state => !!state.busy[key]);
  const creating = action === 'createBranch' || action === 'createTag';
  const progress = ['abortMerge', 'abortRebase', 'continueRebase'].includes(action);
  useEffect(() => {
    let disposed = false;
    void getGitReferences(target).then(result => {
      if (disposed) return;
      const choices = result.filter(reference => action === 'deleteTag' ? reference.kind === 'tag' : ['renameBranch', 'deleteBranch', 'switchBranch'].includes(action) ? reference.kind === 'branch'
        : reference.kind !== 'tag' && reference.shortName !== snapshot.branch);
      setRefs(result); setSelected(choices[0]?.name ?? '');
    }).catch(reason => { if (!disposed) setError(String(reason)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [target.cwd, target.connectionId, action, snapshot.branch]);
  const choices = refs.filter(reference => action === 'deleteTag' ? reference.kind === 'tag' : ['renameBranch', 'deleteBranch', 'switchBranch'].includes(action) ? reference.kind === 'branch'
    : reference.kind !== 'tag' && reference.shortName !== snapshot.branch);
  const enabled = !busy && !loading && (progress || (creating ? !!name.trim() : !!selected && (action !== 'renameBranch' || !!name.trim())));
  const apply = async () => {
    if (!enabled || !useGitOperations.getState().begin(key, action)) return;
    setError('');
    try {
      await editGitReference(target, action, creating ? name.trim() : selected, { ...(creating ? { startPoint: start } : {}), ...(action === 'renameBranch' ? { newName: name.trim() } : {}), ...(action === 'createTag' ? { message } : {}) });
      refresh(); onClose();
    } catch (reason) { setError(String(reason)); refresh(); }
    finally { useGitOperations.getState().finish(key); }
  };
  return <ToolDialog label={referenceActionLabel(action)} width={520} onClose={onClose} onSubmit={() => { void apply(); }} busy={busy} initialFocus={creating ? 'input' : undefined}>
    <div className="git-reference-form" data-testid="git-reference-dialog">
      <p className="git-commit-hint">{target.cwd} · {snapshot.branch}</p>
      {!creating && !progress && <label>{t(action === 'deleteTag' ? 'Tag' : 'Branch')}<Select aria-label={t(action === 'deleteTag' ? 'Tag' : 'Branch')} value={selected} onChange={setSelected}
        options={choices.map(reference => ({ value: reference.name, label: reference.shortName }))} /></label>}
      {(creating || action === 'renameBranch') && <label>{t('New name')}<TextInput variant="field" aria-label={t('New name')} value={name} onChange={event => setName(event.target.value)} /></label>}
      {creating && <label>{t('Starting point')}<Select aria-label={t('Starting point')} value={start} onChange={setStart} options={[{ value: 'HEAD', label: 'HEAD' }, ...refs.map(reference => ({ value: reference.name, label: reference.shortName }))]} /></label>}
      {action === 'createTag' && <label>{t('Tag message (optional)')}<ConfigTextArea font="ui" rows={3} aria-label={t('Tag message (optional)')} value={message} onChange={event => setMessage(event.target.value)} /></label>}
      {action === 'merge' && <p className="git-commit-hint">{t('Merge the selected branch into {{branch}}.', { branch: snapshot.branch })}</p>}
      {action === 'rebase' && <p className="git-commit-hint">{t('Replay {{branch}} on the selected branch. This rewrites local commit history.', { branch: snapshot.branch })}</p>}
      {action === 'deleteBranch' && <p className="git-commit-hint">{t('Only merged branches can be deleted. Checked-out branches are protected.')}</p>}
      {progress && <p className="git-commit-hint">{t(action === 'continueRebase' ? 'Stage resolved conflicts before continuing the rebase.' : 'Abort the current operation and return to its starting state.')}</p>}
      {loading && <p role="status" className="git-commit-hint">{t('Loading references…')}</p>}
      {error && <ErrorBox title={t('Repository operation failed')} details={error} onDismiss={() => setError('')} />}
      <footer className="git-dialog-actions"><OutlineButton disabled={busy} onClick={onClose}>{t('Cancel')}</OutlineButton>
        <OutlineButton className="primary-button" disabled={!enabled} onClick={() => { void apply(); }}>{busy ? t('Repository operation in progress…') : referenceActionLabel(action)}</OutlineButton></footer>
    </div>
  </ToolDialog>;
}
