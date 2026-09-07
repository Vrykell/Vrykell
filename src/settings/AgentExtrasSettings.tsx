/**
 * AgentExtrasSettings — 记忆 / 子代理 / 定时任务 设置页。
 * 记忆 = 持久知识 FACT + 流水 JOURNAL（可一键让 AI 整理）；
 * 子代理 = 独立系统提示词助手；定时任务 = 间隔执行（AI 也可用工具自行管理）。
 */

import { invoke } from '@tauri-apps/api/core';
import { generateText } from 'ai';
import { Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type AgentDef,
  getMemory,
  getMemoryJournal,
  listAgents,
  listSchedules,
  removeAgent,
  removeSchedule,
  type Schedule,
  saveAgent,
  saveSchedule,
  setMemory,
} from '@/agent/platform';
import { createChatModel, type ProviderKind } from '@/agent/provider';
import { kickScheduleRunner } from '@/agent/scheduleRunner';
import { useToastStore } from '@/components/Toast';

const toast = (msg: string, type: 'info' | 'success' | 'error') =>
  useToastStore.getState().addToast(msg, type);

const inputStyle: React.CSSProperties = {
  background: 'var(--canvas)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)',
  padding: '6px 8px',
  fontSize: 12,
  color: 'var(--text-primary)',
  outline: 'none',
  width: '100%',
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-inner)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
};

// ── 记忆 ──

export function MemorySettings() {
  const [fact, setFact] = useState('');
  const [journal, setJournal] = useState('');
  const [organizing, setOrganizing] = useState(false);

  const refresh = () => {
    getMemory()
      .then(setFact)
      .catch((e) => console.warn('[memory] 读取记忆失败:', e));
    getMemoryJournal()
      .then(setJournal)
      .catch((e) => console.warn('[memory] 读取流水失败:', e));
  };
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    try {
      await setMemory(fact);
      toast('已保存', 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const clear = async () => {
    try {
      await setMemory('');
      setFact('');
      toast('已清空持久知识', 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  /** 让 AI 把持久知识 + 流水压缩整理成结构化知识 */
  const organize = async () => {
    setOrganizing(true);
    try {
      const curFact = await getMemory();
      const curJournal = await getMemoryJournal();
      const info = await invoke<{ base_url: string; model: string; provider: ProviderKind }>(
        'get_ai_config',
      );
      const model = createChatModel({
        provider: info.provider,
        baseUrl: info.base_url,
        model: info.model,
      });
      const { text } = await generateText({
        model,
        system:
          '你是记忆整理器。把用户长期记忆（持久知识 + 流水）整理成简洁的结构化 Markdown：' +
          '保留重要事实、用户偏好、项目约定、待办事项；合并重复、删除过时内容。只输出整理后的内容。',
        prompt: `持久知识：\n${curFact || '（空）'}\n\n流水：\n${curJournal || '（空）'}`,
      });
      await setMemory(text.trim());
      setFact(text.trim());
      toast('已整理记忆', 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setOrganizing(false);
    }
  };

  const jlines = journal.split('\n').filter(Boolean).slice(-20);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
          持久知识会注入每次对话；AI 可用「记忆」工具自行读写与整理，也可一键让 AI 整理。
        </span>
        <button
          onClick={() => void organize()}
          disabled={organizing}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Sparkles size={12} /> {organizing ? '整理中…' : '让 AI 整理'}
        </button>
      </div>
      <textarea
        value={fact}
        onChange={(e) => setFact(e.target.value)}
        rows={10}
        placeholder="持久知识（偏好、约定、待办…）"
        style={{ ...inputStyle, minHeight: 160, resize: 'vertical', lineHeight: 1.6 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => void save()} style={btnStyle}>
          保存
        </button>
        <button onClick={() => void clear()} style={{ ...btnStyle, color: 'var(--error-light)' }}>
          清空
        </button>
      </div>
      {jlines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>近期流水</div>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              maxHeight: 180,
              overflow: 'auto',
              background: 'var(--hover)',
              borderRadius: 'var(--radius-inner)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-secondary)',
            }}
          >
            {jlines.join('\n')}
          </pre>
        </div>
      )}
    </>
  );
}

// ── 子代理 ──

function AgentCard({ a, onChanged }: { a: AgentDef; onChanged: () => void }) {
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description);
  const [prompt, setPrompt] = useState(a.prompt);
  const save = async () => {
    try {
      await saveAgent({ id: a.id, name: name.trim(), description, prompt });
      toast('已保存', 'success');
      onChanged();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  const del = async () => {
    try {
      await removeAgent(a.id);
      toast('已删除', 'success');
      onChanged();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  return (
    <div
      style={{
        borderRadius: 'var(--radius-inner)',
        padding: '10px 12px',
        background: 'var(--canvas)',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          placeholder="名称"
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
        />
        <button onClick={() => void save()} style={btnStyle}>
          保存
        </button>
        <button
          onClick={() => void del()}
          title="删除"
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid transparent',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={13} />
        </button>
      </div>
      <input
        value={description}
        placeholder="一句话描述何时委派给它"
        onChange={(e) => setDescription(e.target.value)}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      <textarea
        value={prompt}
        placeholder="系统提示词（行为准则）"
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        style={{ ...inputStyle, marginTop: 8, minHeight: 80, resize: 'vertical', lineHeight: 1.55 }}
      />
    </div>
  );
}

export function AgentsSettings() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const refresh = () =>
    listAgents()
      .then(setAgents)
      .catch((e) => console.warn('[agents] 读取子代理失败:', e));
  useEffect(() => {
    refresh();
  }, []);
  const add = async () => {
    try {
      await saveAgent({ id: '', name: `子代理 ${agents.length + 1}`, description: '', prompt: '' });
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        子代理 = 独立系统提示词的助手，主 AI 用「子代理」工具委派任务，也可自行创建、删除。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {agents.map((a) => (
          <AgentCard key={a.id} a={a} onChanged={refresh} />
        ))}
        <button
          onClick={() => void add()}
          style={{
            ...btnStyle,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
          }}
        >
          <Plus size={12} /> 添加子代理
        </button>
      </div>
    </>
  );
}

// ── 定时任务 ──

function ScheduleCard({ s, onChanged }: { s: Schedule; onChanged: () => void }) {
  const [name, setName] = useState(s.name);
  const [prompt, setPrompt] = useState(s.prompt);
  const [interval, setIntervalM] = useState(s.intervalMinutes);
  const [enabled, setEnabled] = useState(s.enabled);
  const save = async () => {
    try {
      await saveSchedule({
        id: s.id,
        name: name.trim(),
        prompt,
        intervalMinutes: Math.max(1, interval),
        enabled,
        lastRunAt: s.lastRunAt,
      });
      toast('已保存', 'success');
      onChanged();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  const del = async () => {
    try {
      await removeSchedule(s.id);
      toast('已删除', 'success');
      onChanged();
      kickScheduleRunner();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  const nextRun = s.lastRunAt ? s.lastRunAt + s.intervalMinutes * 60_000 : Date.now();
  return (
    <div
      style={{
        borderRadius: 'var(--radius-inner)',
        padding: '10px 12px',
        background: 'var(--canvas)',
        opacity: enabled ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          value={name}
          placeholder="名称"
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
        />
        <input
          type="number"
          min={1}
          value={interval}
          onChange={(e) => setIntervalM(Number(e.target.value))}
          style={{ ...inputStyle, width: 70, flexShrink: 0 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>分钟</span>
        <button onClick={() => setEnabled((v) => !v)} style={{ ...btnStyle }}>
          {enabled ? '停用' : '启用'}
        </button>
        <button onClick={() => void save()} style={btnStyle}>
          保存
        </button>
        <button
          onClick={() => void del()}
          title="删除"
          style={{
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid transparent',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={13} />
        </button>
      </div>
      <textarea
        value={prompt}
        placeholder="要执行的提示词"
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        style={{ ...inputStyle, marginTop: 8, minHeight: 56, resize: 'vertical', lineHeight: 1.55 }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        上次执行 {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '从未'}
        {enabled ? ` · 下次 ${new Date(nextRun).toLocaleString()}` : ''}
      </div>
    </div>
  );
}

export function SchedulesSettings() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // 调度在应用级运行（agent/scheduleRunner.ts，App.tsx 挂载一次）；
  // 此处只负责展示，保存/删除后踢一次立即检查。
  const refresh = () =>
    listSchedules()
      .then(setSchedules)
      .catch((e) => console.warn('[schedules] 读取定时任务失败:', e));
  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    try {
      await saveSchedule({
        id: '',
        name: `任务 ${schedules.length + 1}`,
        prompt: '',
        intervalMinutes: 60,
        enabled: false,
        lastRunAt: 0,
      });
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        定时任务在应用运行期间按间隔触发；AI 也可用「定时任务」工具自行创建、启停、删除。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {schedules.map((s) => (
          <ScheduleCard key={s.id} s={s} onChanged={refresh} />
        ))}
        <button
          onClick={() => void add()}
          style={{
            ...btnStyle,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
          }}
        >
          <Plus size={12} /> 添加任务
        </button>
      </div>
    </>
  );
}
