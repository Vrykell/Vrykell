import { beforeEach, describe, expect, it } from 'vitest';
import { selectPaneInput, useInputStore } from '@/store/input';

const initial = useInputStore.getState();

describe('input store（每 pane 独立输入态）', () => {
  beforeEach(() => useInputStore.setState(initial, true));

  it('setText / setAiMode 按 pane 隔离', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().setAiMode('a', true);
    useInputStore.getState().setText('b', 'pwd');

    expect(selectPaneInput('a')(useInputStore.getState())).toEqual({ text: 'ls', aiMode: true });
    expect(selectPaneInput('b')(useInputStore.getState())).toEqual({ text: 'pwd', aiMode: false });
  });

  it('clearText 清空文本但保留 AI 模式', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().setAiMode('a', true);
    useInputStore.getState().clearText('a');

    expect(selectPaneInput('a')(useInputStore.getState())).toEqual({ text: '', aiMode: true });
  });

  it('dropPane 删除该 pane 状态', () => {
    useInputStore.getState().setText('a', 'ls');
    useInputStore.getState().dropPane('a');
    expect(useInputStore.getState().byPane['a']).toBeUndefined();
  });

  it('selectPaneInput 缺失时返回稳定空态（避免无限重渲染）', () => {
    const s1 = selectPaneInput('missing')(useInputStore.getState());
    const s2 = selectPaneInput('missing')(useInputStore.getState());
    expect(s1).toEqual({ text: '', aiMode: false });
    expect(s1).toBe(s2);
  });
});
