import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Select from '../Select';

const options = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中', disabled: true },
  { value: 'high', label: '高' },
];

describe('Select', () => {
  it('uses a concise trigger label while keeping full context in the menu', () => {
    render(<Select aria-label="Target" value="server" onChange={vi.fn()}
      options={[{ value: 'server', label: 'Production server · 10.21.76.61 · /srv/app', triggerLabel: '10.21.76.61' }]} />);
    expect(screen.getByRole('combobox', { name: 'Target' })).toHaveTextContent('10.21.76.61');
    expect(screen.getByRole('combobox', { name: 'Target' })).not.toHaveTextContent('/srv/app');
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    expect(screen.getByRole('option', { name: 'Production server · 10.21.76.61 · /srv/app' })).toBeInTheDocument();
  });
  it('renders a controlled value and commits a pointer selection once', async () => {
    const onChange = vi.fn();
    function Example() {
      const [value, setValue] = useState('low');
      return <Select aria-label="思考强度" value={value} options={options} onChange={next => { setValue(next); onChange(next); }} />;
    }
    render(<Example />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('combobox', { name: '思考强度' });
    expect(trigger).toHaveTextContent('低');
    await user.click(trigger);
    expect(screen.getByRole('option', { name: '低' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: '高' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('high');
    expect(trigger).toHaveTextContent('高');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('skips disabled options, wraps navigation and cancels without changing the value', async () => {
    const onChange = vi.fn();
    render(<Select aria-label="思考强度" value="low" options={options} onChange={onChange} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: '高' }).id);
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: '低' }).id);
    await user.keyboard('{End}{Home}{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('high');
  });

  it('supports numeric values, space selection and label search', async () => {
    const onChange = vi.fn();
    render(<Select aria-label="字号" value={12} options={[{ value: 12, label: '12px' }, { value: 16, label: '16px' }]} onChange={onChange} />);
    const user = userEvent.setup();
    screen.getByRole('combobox').focus();
    await user.keyboard(' {End} ');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(16);
    onChange.mockClear();
    await user.keyboard('16{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(16);
  });

  it('closes on outside interaction and Tab without trapping focus', async () => {
    render(<><Select aria-label="强度" value="low" options={options} onChange={vi.fn()} /><button>下一个</button></>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一个' })).toHaveFocus();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('button', { name: '下一个' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一个' })).toHaveFocus();
  });

  it('handles disabled controls, empty options and unmatched values', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Select aria-label="仓库" value="custom" options={options} onChange={onChange} placeholder="自定义…" disabled />);
    const user = userEvent.setup();
    expect(screen.getByRole('combobox')).toBeDisabled();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rerender(<Select aria-label="仓库" value="custom" options={[]} onChange={onChange} placeholder="自定义…" />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveTextContent('自定义…');
    rerender(<Select aria-label="仓库" value="custom" options={options} onChange={onChange} placeholder="自定义…" />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: '中' }));
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Select aria-label="仓库" value="custom" options={options} onChange={onChange} disabled />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('flips the portal above a trigger near the viewport bottom', async () => {
    render(<Select aria-label="强度" value="low" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: 950, y: 720, top: 720, bottom: 750, left: 950, right: 1060, width: 110, height: 30, toJSON: () => ({}) });
    await userEvent.setup().click(trigger);
    const menu = screen.getByRole('listbox');
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveAttribute('data-placement', 'top');
    expect(parseFloat(menu.style.left)).toBeLessThan(950);
    fireEvent.blur(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks the selected option with a non-character check icon', async () => {    render(<Select aria-label="强度" value="low" options={options} onChange={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('combobox'));
    const selected = screen.getByRole('option', { name: '低' });
    const check = selected.querySelector('svg.ui-select-check');
    expect(check).not.toBeNull();
    expect(check).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('option', { name: '高' }).querySelector('svg')).toBeNull();
  });

  it('renders a colour swatch in the trigger and in the option rows', async () => {
    render(<Select aria-label="颜色" value="blue" onChange={vi.fn()}
      options={[{ value: 'blue', label: '蓝色', swatch: '#0A84FF' }, { value: 'green', label: '绿色', swatch: '#6CE6A6' }]} />);
    const trigger = screen.getByRole('combobox', { name: '颜色' });
    expect(trigger.querySelector('span.ui-select-swatch')).toHaveStyle({ background: '#0A84FF' });
    await userEvent.setup().click(trigger);
    expect(screen.getByRole('option', { name: '蓝色' }).querySelector('span.ui-select-swatch')).toHaveStyle({ background: '#0A84FF' });
    expect(screen.getByRole('option', { name: '绿色' }).querySelector('span.ui-select-swatch')).not.toBeNull();
  });
});
