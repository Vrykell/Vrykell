import { useEffect, useRef, useState } from 'react';
import { marketGithubInstall, marketGithubList, type MarketSkill } from '@features/agent/services/skills';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

const pendingLists = new Map<string, Promise<MarketSkill[]>>();
function loadMarketplace(repo: string) {
  let pending = pendingLists.get(repo);
  if (!pending) {
    pending = marketGithubList(repo).finally(() => pendingLists.delete(repo));
    pendingLists.set(repo, pending);
  }
  return pending;
}

export function useSkillMarketplace(initialRepo: string, onInstalled: () => void) {
  const [repo, setRepo] = useState(initialRepo);
  const [remote, setRemote] = useState<MarketSkill[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const current = useRef({ repo: initialRepo, revision: 0, loadedRepo: '', mounted: true });
  const changeRepo = (next: string) => {
    current.current.repo = next;
    current.current.loadedRepo = '';
    current.current.revision++;
    setRepo(next); setRemote([]); setError(''); setBrowsing(false);
  };
  const browse = async (source = current.current.repo) => {
    const repository = source.trim();
    if (!repository) return;
    const revision = ++current.current.revision;
    setBrowsing(true); setError(''); setRemote([]); current.current.loadedRepo = '';
    try {
      const list = await loadMarketplace(repository);
      if (!current.current.mounted || current.current.revision !== revision) return;
      current.current.loadedRepo = repository;
      setRemote(list);
    } catch (failure) {
      if (current.current.mounted && current.current.revision === revision) setError(String(failure));
    } finally {
      if (current.current.mounted && current.current.revision === revision) setBrowsing(false);
    }
  };
  const install = async (skill: MarketSkill) => {
    const repository = current.current.loadedRepo;
    const key = `${repository}/${skill.dir}`;
    if (!repository || installing.has(key)) return;
    setInstalling(previous => new Set(previous).add(key));
    try {
      await marketGithubInstall(repository, skill.dir);
      useToastStore.getState().addToast(t('Installed {{name}}', { name: skill.name }), 'success');
      onInstalled();
    } catch (failure) {
      useToastStore.getState().addToast(String(failure), 'error');
    } finally {
      if (current.current.mounted) setInstalling(previous => { const next = new Set(previous); next.delete(key); return next; });
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void browse();
    return () => { current.current.mounted = false; current.current.revision++; };
  }, []);
  return { repo, remote, browsing, error, changeRepo, browse, install,
    isInstalling: (skill: MarketSkill) => installing.has(`${current.current.loadedRepo}/${skill.dir}`) };
}
