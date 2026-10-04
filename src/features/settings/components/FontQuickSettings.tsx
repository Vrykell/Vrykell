import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useTypographyStore } from '@config/typography';
import Segmented from '@ui/Segmented';

export default function FontQuickSettings() {
  const { uiFontSize, terminalFontSize, update, reset } = useTypographyStore();
  return <div className="settings-font-quick" aria-label="字号快速设置">
    <div className="settings-font-row">
      <span>界面字号</span>
      <Segmented value={String(uiFontSize)} options={[12, 13, 15].map(size => ({ value: String(size), label: `${size}` }))}
        onChange={size => update({ uiFontSize: Number(size) })} size="sm" />
      <span className="text-caption">{uiFontSize}px</span>
    </div>
    <div className="settings-font-row">
      <span>终端字号</span>
      <button aria-label="减小终端字号" disabled={terminalFontSize <= 10} onClick={() => update({ terminalFontSize: terminalFontSize - 1 })}><Minus size={13} /></button>
      <output data-testid="terminal-font-size">{terminalFontSize}px</output>
      <button aria-label="增大终端字号" disabled={terminalFontSize >= 24} onClick={() => update({ terminalFontSize: terminalFontSize + 1 })}><Plus size={13} /></button>
    </div>
    <button aria-label="恢复默认字号" onClick={reset}><RotateCcw size={13} /></button>
  </div>;
}
