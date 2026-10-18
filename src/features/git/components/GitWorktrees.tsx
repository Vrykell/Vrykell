import { useEffect, useState } from 'react';
import type { GitTarget, GitWorktree } from '@core/git';
import { getGitWorktrees } from '@platform/api/git';
import SidebarItem from '@ui/sidebarItem';
import ErrorBox from '@ui/ErrorBox';
import { TextButton } from '@ui/TextButton';
import { GitBranch, Check } from '@ui/icons';
import { t } from '@i18n';

export default function GitWorktrees({ target, onSelect, revision }: { target: GitTarget; revision: number; onSelect: (path: string) => void }) {
  const [trees, setTrees] = useState<GitWorktree[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(''); setTrees([]);
    void getGitWorktrees(target).then(result => { if (!disposed) setTrees(result); })
      .catch(reason => { if (!disposed) setError(String(reason)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [target.cwd, target.connectionId, revision, retry]);
  return <div className="git-files scroll-region" data-testid="git-worktrees" aria-label={t('Worktrees')}>
    {loading && <div className="git-empty" role="status">{t('Loading worktrees…')}</div>}
    {error && <ErrorBox title={t('Could not load worktrees')} details={error} actions={<TextButton onClick={() => setRetry(value => value + 1)}>{t('Retry')}</TextButton>} />}
    {!loading && !error && trees.length === 0 && <div className="git-empty">{t('No worktrees')}</div>}
    {trees.map(tree => <SidebarItem key={tree.path} title={tree.branch || (tree.bare ? t('Bare repository') : t('Detached HEAD'))}
      subtitle={tree.path} icon={<GitBranch size={14} />} active={tree.path === target.cwd} tooltip={[tree.path, tree.locked !== null ? `${t('Locked')}: ${tree.locked}` : '', tree.prunable !== null ? `${t('Unavailable worktree')}: ${tree.prunable}` : ''].filter(Boolean).join('\n')}
      badge={tree.path === target.cwd ? <Check size={14} /> : <span className="git-count">{tree.prunable !== null ? t('Unavailable worktree') : tree.locked !== null ? t('Locked') : ''}</span>}
      tabIndex={0} onClick={() => { if (!tree.bare && tree.prunable === null) onSelect(tree.path); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.currentTarget.click(); } }} />)}
  </div>;
}
