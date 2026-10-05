import Select from '@ui/Select';
import { Field } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { useStartupSettings } from '../stores/startup';

export function StartupPage() {
  const { mode, setMode } = useStartupSettings();
  const { save } = useSettingsSave();
  return <Field title="启动时打开" description="设置将在下次启动时生效。恢复上次的会话时将重新建立连接；正在运行的进程不会恢复。若无可恢复会话，将自动创建默认终端。">
    <Select aria-label="启动时打开" value={mode} onChange={next => { void save(() => setMode(next)); }} options={[
      { value: 'restore', label: '恢复上次会话' },
      { value: 'default', label: '新建默认终端' },
      { value: 'empty', label: '显示会话记录' },
    ]} />
    <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>关闭最后一个标签页后将显示会话记录。选择其他启动方式后，上次的会话仍可在会话记录中手动打开。</p>
  </Field>;
}
