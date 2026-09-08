import { loadConfig, serializeTemplates } from '@/features/files/fileOpen';
import { getModel, isApiKeyConfigured } from '@/services/tauri/ai';
import { useWorkspaceStore } from '@/store/workspace';

/** 设置项定义 — 供全局搜索索引 */
export interface SettingDef {
  id: string;
  label: string;
  desc: string;
  /** 获取当前值的快照 */
  getValue: () => string;
  /** 点击此设置项时执行 */
  onSelect: () => void;
}

const _settings: SettingDef[] = [];

/** 注册一个设置项 */
export function registerSetting(s: SettingDef) {
  if (!_settings.some((x) => x.id === s.id)) {
    _settings.push(s);
  }
}

/** 获取所有已注册的设置项 */
export function getSettings(): SettingDef[] {
  return _settings;
}

/** 按 query 搜索设置项 */
export function searchSettings(query: string): SettingDef[] {
  const lower = query.toLowerCase();
  return _settings.filter(
    (s) => s.label.toLowerCase().includes(lower) || s.desc.toLowerCase().includes(lower),
  );
}

// ── 注册所有设置项 ──

registerSetting({
  id: 'api-key',
  label: 'API Key',
  desc: 'AI 服务 API 密钥',
  getValue: () => (isApiKeyConfigured() ? '已配置' : '未配置'),
  onSelect: () => useWorkspaceStore.getState().openSettingsTab(),
});

registerSetting({
  id: 'model',
  label: '模型 ID',
  desc: 'AI 模型标识符',
  getValue: () => getModel(),
  onSelect: () => useWorkspaceStore.getState().openSettingsTab(),
});

registerSetting({
  id: 'theme',
  label: '主题',
  desc: '深色 / 浅色模式切换',
  getValue: () => (document.documentElement.dataset.theme === 'light' ? '浅色' : '深色'),
  onSelect: () => useWorkspaceStore.getState().openSettingsTab(),
});

registerSetting({
  id: 'file-open',
  label: '文件打开方式',
  desc: '文件面板的默认终端编辑器与按扩展名打开模板',
  getValue: () => {
    const cfg = loadConfig();
    const tpl = serializeTemplates(cfg.templates);
    return tpl ? `${cfg.defaultEditor}（${tpl.replace(/\n/g, '，')}）` : cfg.defaultEditor;
  },
  onSelect: () => useWorkspaceStore.getState().openSettingsTab(),
});
