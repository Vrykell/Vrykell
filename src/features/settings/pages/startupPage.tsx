import Select from '@ui/Select';
import { Field } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { useStartupSettings } from '../stores/startup';

export function StartupPage() {
  const { mode, setMode } = useStartupSettings();
  const { save } = useSettingsSave();
  return <Field title="启动时打开" description="下次启动时生效。恢复标签页会重建会话连接，不会恢复正在运行的进程；没有可恢复标签时打开默认终端。">
    <Select aria-label="启动时打开" value={mode} onChange={next => { void save(() => setMode(next)); }} options={[
      { value: 'restore', label: '恢复上次的标签页' },
      { value: 'default', label: '新建默认标签页' },
      { value: 'empty', label: '什么都不新建（显示会话记录）' },
    ]} />
    <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>关闭最后一个标签后显示会话记录，不会自动创建终端。选择不恢复时，上次的会话仍可在会话记录中手动打开。</p>
  </Field>;
}
