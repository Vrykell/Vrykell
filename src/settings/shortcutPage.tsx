/**
 * shortcutPage — 快捷键说明页。
 */
import { Field } from '@/settings/ui';

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['⌘T'], desc: '新建标签页' },
  { keys: ['⌘⇧T'], desc: '撤销关闭标签' },
  { keys: ['⌘W'], desc: '关闭标签页' },
  { keys: ['⌘1–9'], desc: '切换到第 N 个标签' },
  { keys: ['⌘D'], desc: '分裂终端，选择落点并继承类型' },
  { keys: ['⌘⇧D'], desc: '直接上下分裂' },
  { keys: ['⌥⌘D'], desc: '选择类型后分裂' },
  { keys: ['⌘]', '⌘['], desc: '在窗口内终端间切换焦点' },
  { keys: ['⌘F'], desc: '全局搜索' },
  { keys: ['⌘P'], desc: '命令面板' },
  { keys: ['⌘,'], desc: '打开设置' },
  { keys: ['⌘+', '⌘-', '⌘0'], desc: '放大 / 缩小 / 重置终端字号' },
  { keys: ['Ctrl+Shift+B'], desc: '切换书签' },
  { keys: ['Esc'], desc: '切回命令输入栏' },
];

export function ShortcutPage() {
  return (
    <Field title="快捷键说明" description="当前支持的键盘快捷键，macOS 下 ⌘ = Command。">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-inner)',
          overflow: 'hidden',
        }}
      >
        {SHORTCUTS.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '8px 12px',
              background: i % 2 === 0 ? 'transparent' : 'var(--hover)',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{s.desc}</span>
            <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
              {s.keys.map((k, j) => (
                <kbd
                  key={j}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--canvas)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Field>
  );
}
