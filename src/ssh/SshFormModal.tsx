import { useEffect, useState } from 'react';
import { Loader2, Plug, Trash2 } from 'lucide-react';
import { newSshId, validateSshConnection, sshTest, type SshConnection, type SshAuthMethod } from './api';
import { useSshStore } from './store';
import { useToastStore } from '../components/Toast';

interface Props {
  open: boolean;
  /** 编辑目标；null 表示新建 */
  initial: SshConnection | null;
  onClose: () => void;
}

/** 通用字段样式 */
const field: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4,
  background: 'var(--canvas)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 8px', fontSize: 12,
  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
};
const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)' };

/**
 * SshFormModal — 新建 / 编辑 SSH 连接弹窗。
 * 字段：连接名、主机、端口、账户、认证方式、密码；提供「测试连接」「保存」「删除」。
 */
export default function SshFormModal({ open, initial, onClose }: Props) {
  const save = useSshStore((s) => s.save);
  const remove = useSshStore((s) => s.remove);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('password');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setHost(initial?.host ?? '');
    setPort(initial?.port ? String(initial.port) : '');
    setUser(initial?.user ?? '');
    setAuthMethod(initial?.authMethod ?? 'password');
    setPassword(initial?.password ?? '');
    setTestResult(null);
  }, [open, initial]);

  const target = () => ({
    host: host.trim(),
    port: port.trim() ? Number(port.trim()) : undefined,
    user: user.trim(),
    password: authMethod === 'password' ? password : '',
  });

  const doTest = async () => {
    const t = target();
    if (!t.host) { setTestResult({ ok: false, msg: '请先填写主机' }); return; }
    if (t.port !== undefined && (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535)) {
      setTestResult({ ok: false, msg: '端口需为 1-65535 的整数' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await sshTest(t);
      setTestResult({ ok: true, msg });
    } catch (e) {
      setTestResult({ ok: false, msg: String((e as Error)?.message ?? e) });
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    const conn: SshConnection = {
      id: initial?.id ?? newSshId(),
      name: name.trim(),
      host: host.trim(),
      port: port.trim() ? Number(port.trim()) : undefined,
      user: user.trim(),
      authMethod,
      password: authMethod === 'password' ? password : '',
    };
    const err = validateSshConnection(conn);
    if (err) { useToastStore.getState().addToast(err, 'error'); return; }
    try {
      await save(conn);
      useToastStore.getState().addToast(initial ? '已更新连接' : '已添加连接', 'success');
      onClose();
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doDelete = async () => {
    if (!initial) return;
    try {
      await remove(initial.id);
      useToastStore.getState().addToast('已删除连接', 'success');
      onClose();
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9996,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 400, maxHeight: '82vh', overflowY: 'auto',
          background: 'var(--elevated)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-block)', boxShadow: 'var(--shadow-lg)',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {initial ? '编辑 SSH 连接' : '新建 SSH 连接'}
        </div>

        <label style={label}>
          连接名
          <input value={name} placeholder="生产服务器" onChange={(e) => setName(e.target.value)} style={field} data-testid="ssh-form-name" />
        </label>

        <label style={label}>
          主机（IP / 域名）
          <input value={host} placeholder="192.168.1.10" onChange={(e) => setHost(e.target.value)} style={field} data-testid="ssh-form-host" />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ ...label, flex: 1 }}>
            端口
            <input value={port} placeholder="22" onChange={(e) => setPort(e.target.value)} style={field} data-testid="ssh-form-port" />
          </label>
          <label style={{ ...label, flex: 1 }}>
            账户
            <input value={user} placeholder="root" onChange={(e) => setUser(e.target.value)} style={field} data-testid="ssh-form-user" />
          </label>
        </div>

        <label style={label}>
          认证方式
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {(['password', 'key'] as const).map((m) => (
              <button
                key={m}
                data-subtle
                onClick={() => setAuthMethod(m)}
                style={{
                  flex: 1, padding: '5px 0', fontSize: 12, borderRadius: 'var(--radius-inner)',
                  border: `1px solid ${authMethod === m ? 'var(--accent)' : 'var(--border)'}`,
                  background: authMethod === m ? 'var(--accent-dim)' : 'transparent',
                  color: authMethod === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {m === 'password' ? '密码' : '密钥'}
              </button>
            ))}
          </div>
        </label>

        {authMethod === 'password' && (
          <label style={label}>
            密码
            <input type="password" value={password} placeholder={initial?.hasPassword ? '留空则不修改' : '••••••'} onChange={(e) => setPassword(e.target.value)} style={field} data-testid="ssh-form-password" />
          </label>
        )}
        {authMethod === 'key' && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            使用本机默认密钥 / SSH Agent 认证。
          </div>
        )}

        <button
          onClick={doTest}
          disabled={testing}
          data-testid="ssh-test-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '6px 0', fontSize: 12, border: '1px solid var(--border)',
            borderRadius: 'var(--radius-inner)', background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >
          {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}
          {testing ? '测试中…' : '测试连接'}
        </button>

        {testResult && (
          <div style={{
            fontSize: 12, padding: '6px 8px', borderRadius: 'var(--radius-inner)',
            color: testResult.ok ? 'var(--success)' : 'var(--error-light)',
            background: testResult.ok ? 'var(--success-bg)' : 'var(--error-bg)',
          }} data-testid="ssh-test-result">
            {testResult.msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          {initial && (
            <button
              onClick={doDelete}
              data-testid="ssh-delete-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)',
                borderRadius: 'var(--radius-inner)', background: 'transparent',
                color: 'var(--error-light)', cursor: 'pointer',
              }}
            >
              <Trash2 size={12} /> 删除
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)',
            borderRadius: 'var(--radius-inner)', background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            取消
          </button>
          <button onClick={doSave} data-testid="ssh-save-btn" style={{
            padding: '6px 16px', fontSize: 12, border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--accent)',
            color: 'var(--accent-text)', cursor: 'pointer',
          }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
