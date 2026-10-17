import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import HistoryGroupCard from '../HistoryGroupCard';
import { historyGroupColor } from '../historyGroupColor';

afterEach(cleanup);

describe('HistoryGroupCard', () => {
  it('opens the same group actions on right click without collapsing the records', () => {
    const restore = vi.fn();
    render(<HistoryGroupCard id="project" title="Project" count="2 sessions"
      actions={[{ label: 'Restore group', onClick: restore }]}><div>Record</div></HistoryGroupCard>);
    expect(screen.queryByRole('button', { name: 'Restore group' })).toBeNull();
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Project' }), { clientX: 24, clientY: 40 });
    expect(screen.getByText('Record')).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore group' }));
    expect(restore).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('history-group-menu-project')).toHaveFocus();
  });

  it('shows a grouped count and collapses the card rows', () => {
    render(<HistoryGroupCard id="today" title="Today" count="2 sessions"><div>Session row</div></HistoryGroupCard>);
    const toggle = screen.getByRole('button', { name: 'Today' });
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.getByText('Session row')).toBeVisible();
    fireEvent.click(screen.getByText('2 sessions'));
    expect(screen.getByText('Session row')).toBeVisible();
    expect(toggle).not.toContainElement(screen.getByText('2 sessions'));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Session row')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Session row')).toBeVisible();
  });

  it('shows the latest activity outside the collapse control', () => {
    const timestamp = Date.UTC(2026, 9, 14, 10, 30);
    const { container } = render(<HistoryGroupCard id="project" title="Project" count="2 sessions" timestamp={timestamp}><div>Session row</div></HistoryGroupCard>);
    expect(screen.getByRole('heading', { name: 'Project' })).toBeVisible();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', new Date(timestamp).toISOString());
    fireEvent.click(container.querySelector('time')!);
    expect(screen.getByText('Session row')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(screen.queryByText('Session row')).toBeNull();
  });

  it('keeps its color when filtering changes the count or a translated label changes', () => {
    const { rerender } = render(<HistoryGroupCard id="cwd:/workspace/project" title="Project" count="3 sessions"><div>Session row</div></HistoryGroupCard>);
    const card = screen.getByRole('region', { name: 'Project' });
    const color = card.getAttribute('data-group-color');
    rerender(<HistoryGroupCard id="cwd:/workspace/project" title="Renamed project" count="1 session"><div>Session row</div></HistoryGroupCard>);
    expect(screen.getByRole('region', { name: 'Renamed project' })).toHaveAttribute('data-group-color', color);
    expect(screen.getByText('Renamed project')).toHaveAttribute('data-tip', 'Renamed project');
  });

  it('keeps the automatic color without an override', () => {
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions"><span>rows</span></HistoryGroupCard>);
    expect(screen.getByTestId('history-group-card-day:1').getAttribute('data-group-color')).toBe(historyGroupColor('day:1'));
  });

  it('applies a manual color override and marks pinned groups', () => {
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" pinned color="cyan" onTogglePin={() => {}}><span>rows</span></HistoryGroupCard>);
    const card = screen.getByTestId('history-group-card-day:1');
    expect(card.getAttribute('data-group-color')).toBe('cyan');
    expect(card.getAttribute('data-pinned')).toBe('true');
    expect(screen.getByTestId('history-group-pin-day:1')).toBeTruthy();
  });

  it('toggles the pin through the group menu', () => {
    const onTogglePin = vi.fn();
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" onTogglePin={onTogglePin}><span>rows</span></HistoryGroupCard>);
    fireEvent.click(screen.getByTestId('history-group-menu-day:1'));
    fireEvent.click(screen.getByText(t('Pin group')));
    expect(onTogglePin).toHaveBeenCalled();
  });

  it('shows the unpin label for pinned groups', () => {
    const onTogglePin = vi.fn();
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" pinned onTogglePin={onTogglePin}><span>rows</span></HistoryGroupCard>);
    fireEvent.click(screen.getByTestId('history-group-menu-day:1'));
    fireEvent.click(screen.getByText(t('Unpin group')));
    expect(onTogglePin).toHaveBeenCalled();
  });

  it('picks a color from the chip palette and can reset to automatic', () => {
    const onSelectColor = vi.fn();
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" onSelectColor={onSelectColor}><span>rows</span></HistoryGroupCard>);
    fireEvent.click(screen.getByTestId('history-group-color-day:1'));
    const swatches = screen.getByTestId('history-group-palette-day:1').querySelectorAll<HTMLButtonElement>('.history-palette-swatch');
    fireEvent.click(swatches[0]!);
    expect(onSelectColor).toHaveBeenCalledWith('blue');

    fireEvent.click(screen.getByTestId('history-group-color-day:1'));
    fireEvent.click(screen.getByTestId('history-group-palette-day:1-auto'));
    expect(onSelectColor).toHaveBeenLastCalledWith(null);
  });

  it('places color choices under the actions and supports keyboard selection and reset', () => {
    const select = vi.fn();
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" color="green" onSelectColor={select}
      actions={[{ label: 'Delete records', danger: true, onClick: () => {} }]}><span>rows</span></HistoryGroupCard>);
    const trigger = screen.getByTestId('history-group-menu-day:1');
    fireEvent.click(trigger);
    expect(screen.queryByRole('menuitem', { name: t('Group color') })).toBeNull();
    const blue = screen.getByRole('menuitemradio', { name: t('Blue') });
    expect(screen.getByRole('menuitemradio', { name: t('Green') })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: 'Delete records' }).compareDocumentPosition(blue)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    blue.focus();
    fireEvent.keyDown(blue, { key: 'ArrowRight' });
    expect(screen.getByRole('menuitemradio', { name: t('Green') })).toHaveFocus();
    fireEvent.click(blue);
    expect(select).toHaveBeenCalledWith('blue');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: t('Automatic color') }));
    expect(select).toHaveBeenLastCalledWith(null);
  });

  it('keeps the collapse toggle working next to the group menu', () => {
    render(<HistoryGroupCard id="day:1" title="Today" count="3 sessions" onTogglePin={() => {}}><span>rows</span></HistoryGroupCard>);
    fireEvent.click(screen.getByTestId('history-group-toggle-day:1'));
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('edits the group title and note from its menu without changing record membership', () => {
    const rename = vi.fn();
    const saveNote = vi.fn();
    render(<HistoryGroupCard id="day:1" title="Today" count="1 session" onRename={rename} onNote={saveNote}><span>Record</span></HistoryGroupCard>);
    fireEvent.click(screen.getByTestId('history-group-menu-day:1'));
    fireEvent.click(screen.getByRole('menuitem', { name: t('Rename group…') }));
    const title = screen.getByRole('textbox', { name: t('Group title') });
    fireEvent.change(title, { target: { value: 'Investigation' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(rename).toHaveBeenCalledWith('Investigation');
    expect(screen.getByText('Record')).toBeVisible();
    fireEvent.click(screen.getByTestId('history-group-menu-day:1'));
    fireEvent.click(screen.getByRole('menuitem', { name: t('Add group note…') }));
    const note = screen.getByRole('textbox', { name: t('Group note') });
    fireEvent.change(note, { target: { value: 'Follow up' } });
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
    expect(saveNote).toHaveBeenCalledWith('Follow up');
  });

  it('reports controlled collapse changes and disables protected group actions', () => {
    const collapse = vi.fn();
    render(<HistoryGroupCard id="locked" title="Locked" count="1 session" collapsed lockedCount={1} onCollapsedChange={collapse}
      actions={[{ label: 'Delete records', disabled: true, danger: true, onClick: vi.fn() }]}><span>Record</span></HistoryGroupCard>);
    expect(screen.queryByText('Record')).toBeNull();
    fireEvent.click(screen.getByTestId('history-group-toggle-locked'));
    expect(collapse).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId('history-group-menu-locked'));
    expect(screen.getByRole('menuitem', { name: 'Delete records' })).toBeDisabled();
  });
});
