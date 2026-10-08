import { TextInput } from '@ui/TextInput';
import { useEffect, useState } from 'react';
import { Loader2, Plug, Trash2 } from '@ui/icons';
import { newSshId, validateSshConnection, sshTest, sshTrustHostKey, type SshConnection, type SshAuthMethod } from '@features/ssh/services/api';
import { useSshStore } from '@features/ssh';
import { useToastStore } from '@ui/Toast';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { open as chooseFile } from '@tauri-apps/plugin-dialog';

interface Props {
  open: boolean;
  /** 编辑目标；null 表示新建 */
  initial: SshConnection | null;
  onClose: () => void;
  onConnect?: (connection: SshConnection) => void;
}

/** 通用字段样式 */
const field: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 3,
  background: 'var(--canvas)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', padding: '6px 10px', minHeight: 34, boxSizing: 'border-box', fontSize: 'calc(13px * var(--ui-font-scale))',
  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
};
const label: React.CSSProperties = { fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--text-secondary)' };
/** 主字段与辅助字段同排，主字段占多数宽度 */
const rowMain: React.CSSProperties = { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, alignItems: 'end' };
/** 两个常规字段同排 */
const rowEven: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 10, alignItems: 'end' };
/** 次要按钮：测试连接、取消、删除 */
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '6px 12px', minHeight: 34, flexShrink: 0,
  fontSize: 'calc(12px * var(--ui-font-scale))', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

/**
 * SshFormModal — 新建 / 编辑 SSH 连接弹窗。
 * 字段：连接名、主机、端口、账户、认证方式、密码；提供「测试连接」「保存」「删除」。
 */
export default function SshFormModal({ open, initial, onClose, onConnect }: Props) {
  const save = useSshStore((s) => s.save);
  const remove = useSshStore((s) => s.remove);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('password');
  const [password, setPassword] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [jumpHost, setJumpHost] = useState('');
  const [keepalive, setKeepalive] = useState('30');
  const [shellIntegration, setShellIntegration] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pendingTrust, setPendingTrust] = useState<{ host: string; port?: number; fingerprint: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setHost(initial?.host ?? '');
    setPort(initial?.port ? String(initial.port) : '');
    setUser(initial?.user ?? '');
    setAuthMethod(initial?.authMethod ?? 'password');
    setPassword(initial?.password ?? '');
    setIdentityFile(initial?.identityFile ?? '');
    setJumpHost(initial?.jumpHost ?? '');
    setKeepalive(String(initial?.serverAliveInterval ?? 30));
    setShellIntegration(initial ? initial.shellIntegration ?? true : false);
    setTestResult(null);
    setPendingTrust(null);
  }, [open, initial]);

  const target = () => ({
    host: host.trim(),
    port: port.trim() ? Number(port.trim()) : undefined,
    user: user.trim(),
    password: authMethod === 'password' ? password : '',
    identityFile: authMethod === 'key' ? identityFile.trim() || undefined : undefined,
    jumpHost: jumpHost.trim() || undefined,
    serverAliveInterval: Number(keepalive),
    shellIntegration,
  });

  const doTest = async () => {
    const t = target();
    if (!t.host) { setTestResult({ ok: false, msg: '请先填写主机' }); return; }
    const validation = validateSshConnection({ ...t, name: name.trim() || t.host });
    if (validation) { setTestResult({ ok: false, msg: validation }); return; }
    if (t.jumpHost) { setTestResult({ ok: false, msg: '跳板机需交互认证，请保存后连接或使用快速连接。' }); return; }
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
      const msg = String((e as Error)?.message ?? e);
      // 首次连接：主机密钥未记录 → 弹指纹确认，用户信任后再重试
      if (msg.startsWith('HOST_KEY_UNKNOWN:')) {
        setPendingTrust({
          host: t.host,
          port: t.port,
          fingerprint: msg.slice('HOST_KEY_UNKNOWN:'.length),
        });
      } else {
        setTestResult({ ok: false, msg });
      }
    } finally {
      setTesting(false);
    }
  };

  const confirmTrust = async () => {
    if (!pendingTrust) return;
    try {
      await sshTrustHostKey(pendingTrust.host, pendingTrust.port, pendingTrust.fingerprint);
      setPendingTrust(null);
      useToastStore.getState().addToast('已信任该主机，重新测试…', 'info');
      void doTest();
    } catch (e) {
      setPendingTrust(null);
      setTestResult({ ok: false, msg: String((e as Error)?.message ?? e) });
    }
  };

  const doSave = async () => {
    const conn: SshConnection = {
      id: initial?.id ?? newSshId(),
      ...target(),
      name: name.trim() || (onConnect ? `${user.trim() ? `${user.trim()}@` : ''}${host.trim()}` : ''),
      authMethod,
      password: authMethod === 'password' ? password : '',
    };
    const err = validateSshConnection(conn);
    if (err) { useToastStore.getState().addToast(err, 'error'); return; }
    try {
      if (onConnect) { onConnect(conn); onClose(); return; }
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
      <div className="workspace-floating workspace-floating-dialog ssh-form-dialog" role="dialog" aria-modal="true" aria-label="SSH 连接"
        style={{
          width: 480, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 24px)', overflow: 'hidden',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>
          {onConnect ? '快速连接 SSH' : initial ? '编辑 SSH 连接' : '新建 SSH 连接'}
        </div>
        <div data-testid="ssh-form-body" style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, margin: -4, padding: 4 }}>
          <label style={label}>
            {onConnect ? '连接名（可选）' : '连接名'}
            <TextInput value={name} placeholder="生产服务器" onChange={(e) => setName(e.target.value)} style={field} data-testid="ssh-form-name" />
          </label>

          <div style={rowMain}>
            <label style={label}>
              主机（IP / 域名）
              <TextInput value={host} placeholder="192.168.1.10" onChange={(e) => setHost(e.target.value)} style={field} data-testid="ssh-form-host" />
            </label>
            <label style={label}>
              端口
              <TextInput value={port} placeholder="22" onChange={(e) => setPort(e.target.value)} style={field} data-testid="ssh-form-port" />
            </label>
          </div>

          <div style={rowEven}>
            <label style={label}>
              账户
              <TextInput value={user} placeholder="root" onChange={(e) => setUser(e.target.value)} style={field} data-testid="ssh-form-user" />
            </label>
            <div style={label}>
              认证方式
              {/* A plain group keeps every button's accessible name its own label. */}
              <div role="group" aria-label="认证方式" style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                {(['password', 'key'] as const).map((m) => (
                  <button
                    key={m}
                    data-subtle
                    onClick={() => setAuthMethod(m)}
                    style={{
                      flex: 1, minHeight: 34, padding: '6px 0', fontSize: 'calc(13px * var(--ui-font-scale))', borderRadius: 'var(--radius-inner)',
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
            </div>
          </div>

          {authMethod === 'password' ? (
            <label style={label}>
              密码
              <TextInput type="password" value={password} placeholder={initial?.hasPassword ? '留空则不修改' : '••••••'} onChange={(e) => setPassword(e.target.value)} style={field} data-testid="ssh-form-password" />
            </label>
          ) : (
            <label style={label}>
              私钥文件（留空使用默认密钥 / SSH Agent）
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <TextInput value={identityFile} onChange={e => setIdentityFile(e.target.value)} style={field} data-testid="ssh-form-identity" placeholder="私钥的完整路径" />
                <button type="button" style={ghostBtn} onClick={async () => {
                  try {
                    const path = await chooseFile({ multiple: false, directory: false, title: '选择 SSH 私钥' });
                    if (typeof path === 'string') setIdentityFile(path);
                  } catch (error) { useToastStore.getState().addToast(String(error), 'error'); }
                }}>浏览…</button>
              </div>
            </label>
          )}

          <div style={rowMain}>
            <label style={label}>
              跳板机（可选）
              <TextInput value={jumpHost} onChange={e => setJumpHost(e.target.value)} style={field} data-testid="ssh-form-jump" placeholder="用户@主机:端口" data-tip="多个跳板机用逗号分隔" />
            </label>
            <label style={label}>
              保活间隔（秒）
              <TextInput type="number" min={0} max={3600} value={keepalive} onChange={e => setKeepalive(e.target.value)} style={field} data-testid="ssh-form-keepalive" data-tip="0 表示关闭保活" />
            </label>
          </div>

          <label style={{ ...label, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <TextInput type="checkbox" checked={shellIntegration} onChange={e => setShellIntegration(e.target.checked)} data-testid="ssh-form-integration" style={{ marginTop: 2 }} />
            <span>启用远程 Shell 集成（命令分块）<small style={{ display: 'block', marginTop: 2, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>聊天服务器和菜单程序请保持关闭，直接进入服务器的交互界面。</small></span>
          </label>
        </div>

        {testResult && (
          <ErrorBox
            compact
            tone={testResult.ok ? 'success' : 'error'}
            testId="ssh-test-result"
            style={{ flexShrink: 0, maxHeight: 72, overflowY: 'auto' }}
          >
            {testResult.msg}
          </ErrorBox>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {initial && (
            <button onClick={doDelete} data-testid="ssh-delete-btn" style={{ ...ghostBtn, color: 'var(--error-light)' }}>
              <Trash2 size={12} /> 删除
            </button>
          )}
          {!onConnect && (
            <button onClick={doTest} disabled={testing} data-testid="ssh-test-btn" style={ghostBtn}>
              {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}
              {testing ? '测试中…' : '测试连接'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtn}>取消</button>
          <button onClick={doSave} data-testid={onConnect ? 'ssh-connect-btn' : 'ssh-save-btn'} style={{
            minHeight: 34, padding: '6px 18px', fontSize: 'calc(13px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)', background: 'var(--accent)',
            color: 'var(--accent-text)', cursor: 'pointer',
          }}>
            {onConnect ? '连接' : '保存'}
          </button>
        </div>
      </div>
      {pendingTrust && (
        <ConfirmDialog
          open
          title="首次连接：确认主机指纹"
          message={`该主机尚未记录到 known_hosts。\n主机指纹：${pendingTrust.fingerprint}\n\n请核对指纹（联系管理员或从已知可信渠道获取）。确认信任后才会建立连接，否则可能遭遇中间人攻击。`}
          confirmLabel="信任并继续"
          cancelLabel="取消"
          onConfirm={() => void confirmTrust()}
          onCancel={() => setPendingTrust(null)}
        />
      )}
    </div>
  );
}
