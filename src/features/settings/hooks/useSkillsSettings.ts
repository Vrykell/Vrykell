import { useCallback, useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  listSkills, getSkill, removeSkill, installSkillMd, fetchRemoteSkills, importSkillsFromPath,
  setSkillState,
  type SkillMeta, type SkillDetail,
} from '@features/agent/services/skills';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

/** 管理技能设置页的列表、详情、导入和信任状态。 */
export function useSkillsSettings() {
  const [metas, setMetas] = useState<SkillMeta[]>([]);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [warnDismissed, setWarnDismissed] = useState(false);
  const [market, setMarket] = useState(false);

  const toast = useCallback((message: string, type: 'info' | 'success' | 'error') => {
    useToastStore.getState().addToast(message, type);
  }, []);

  const refresh = useCallback(() => {
    void listSkills()
      .then(setMetas)
      .catch((error) => toast(String((error as Error)?.message ?? error), 'error'));
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openDetail = useCallback(async (name: string) => {
    try {
      setDetail(await getSkill(name));
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [toast]);

  const doImportUrl = useCallback(async () => {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const remote = await fetchRemoteSkills(url);
      if (remote.length === 0) {
        toast(t('The manifest is empty.'), 'info');
        return;
      }
      for (const skill of remote) await installSkillMd(skill.name, skill.description, skill.prompt);
      toast(t('Installed {{count}} skills.', { count: remote.length }), 'success');
      setImportUrl('');
      refresh();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    } finally {
      setImporting(false);
    }
  }, [importUrl, refresh, toast]);

  const doImportPath = useCallback(async (directory: boolean) => {
    try {
      const selected = await openDialog({ multiple: false, directory });
      if (typeof selected !== 'string') return;
      setImporting(true);
      try {
        const imported = await importSkillsFromPath(selected);
        toast(t('Imported {{count}} skills.', { count: imported.length }), 'success');
        refresh();
      } finally {
        setImporting(false);
      }
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [refresh, toast]);

  const toggleTrust = useCallback(async (skill: SkillMeta) => {
    try {
      await setSkillState(skill.name, !skill.trusted, undefined);
      refresh();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [refresh, toast]);

  const toggleEnabled = useCallback(async (skill: SkillMeta) => {
    try {
      await setSkillState(skill.name, undefined, !skill.enabled);
      refresh();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [refresh, toast]);

  const del = useCallback(async (name: string) => {
    try {
      await removeSkill(name);
      toast(t('Deleted {{name}}.', { name }), 'success');
      refresh();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [refresh, toast]);

  return {
    metas,
    detail,
    importUrl,
    importing,
    warnDismissed,
    market,
    setImportUrl,
    setWarnDismissed,
    setMarket,
    setDetail,
    refresh,
    openDetail,
    doImportUrl,
    doImportPath,
    toggleTrust,
    toggleEnabled,
    del,
  };
}
