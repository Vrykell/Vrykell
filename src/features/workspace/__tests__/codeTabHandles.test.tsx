import { expect, it } from 'vitest';
import { editorFileKey, type EditorFile } from '@core/editor';
import type { DocumentState } from '@features/editor/stores/documents';
import type { GitSelection } from '@core/git';
import { projectCodeTabs } from '../model/codeTabHandles';
import type { Tab } from '../stores/workspace';

const first: EditorFile = { path: '/repo/one.ts' };
const second: EditorFile = { path: '/repo/two.ts' };
const selection: GitSelection = { target: { cwd: '/repo' }, paneId: 'page', path: 'two.ts', scope: 'unstaged' };

function document(file: EditorFile, text: string, value = text): DocumentState {
  return { file, text, value, revision: '1', kind: 'text', saving: false, loading: false, error: '', request: 1 };
}

const editor: Tab = { id: 'page', title: 'Editor', kind: 'editor', files: [first, second], selected: first };
const review: Tab = {
  id: 'review', title: 'Review', kind: 'git-diff', selection,
  comparisons: [
    { id: 'cmp-unstaged', selection },
    { id: 'cmp-staged', selection: { ...selection, scope: 'staged' } },
  ],
};

it('projects files and comparisons with stable row ids and shared capabilities', () => {
  const handles = projectCodeTabs([editor, review], {}).map(target => target.handle);
  expect(handles.map(handle => handle.id)).toEqual([
    `file:${editorFileKey(first)}`, `file:${editorFileKey(second)}`, 'diff:cmp-unstaged', 'diff:cmp-staged',
  ]);
  expect(handles[0]).toMatchObject({
    label: 'one.ts', tip: '/repo/one.ts',
    capabilities: { renameable: false, groupable: false },
  });
  expect(handles[2]).toMatchObject({ tip: '/repo/two.ts' });
  expect(handles[2]!.label).toContain('two.ts');
});

it('marks a dirty document without changing its identity', () => {
  const handles = projectCodeTabs([editor], {
    [editorFileKey(first)]: document(first, 'saved', 'edited'),
    [editorFileKey(second)]: document(second, 'same'),
  }).map(target => target.handle);
  expect(handles[0]!.label).toBe('one.ts •');
  expect(handles[1]!.label).toBe('two.ts');
});

it('falls back to a single comparison row for a legacy review page', () => {
  const legacy: Tab = { id: 'legacy', title: 'Legacy', kind: 'git-diff', selection };
  const [target] = projectCodeTabs([legacy], {});
  expect(target?.handle.id).toBe('diff:legacy');
  expect(target && 'comparisonId' in target ? target.comparisonId : undefined).toBe('legacy');
  expect(target?.handle.label).toContain('two.ts');
});

it('keeps the file target attached for activation and close guards', () => {
  const [target] = projectCodeTabs([editor], {}).filter(item => 'file' in item && item.file.path === second.path);
  expect(target && 'file' in target ? target.file : undefined).toBe(second);
});

it('ignores tabs that are neither editor pages nor comparisons', () => {
  const terminal: Tab = { id: 'shell', title: 'Shell', kind: 'session', layout: { type: 'leaf', terminal: { id: 'shell#0', kind: 'local' } } };
  expect(projectCodeTabs([terminal], {})).toEqual([]);
});
