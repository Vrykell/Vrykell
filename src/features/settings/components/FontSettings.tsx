import { useTypographyStore } from '@config/typography';
import { Field, btnStyle, inputStyle } from './ui';

export default function FontSettings() {
  const { uiFontSize, terminalFontSize, update, reset } = useTypographyStore();
  return <div aria-label="字号设置">
    <Field title="页面字号" description="调整整个应用的界面文字大小。">
      <label className="settings-font-row">
        <select aria-label="页面字号" value={uiFontSize} onChange={event => update({ uiFontSize: Number(event.target.value) })} style={{ ...inputStyle, width: 110 }}>
          {Array.from({ length: 9 }, (_, index) => index + 10).map(size => <option key={size} value={size}>{size}px</option>)}
        </select>
      </label>
    </Field>
    <Field title="终端字号" description="调整终端输入与输出文字大小。">
      <label className="settings-font-row">
        <select aria-label="终端字号" value={terminalFontSize} onChange={event => update({ terminalFontSize: Number(event.target.value) })} style={{ ...inputStyle, width: 110 }}>
          {Array.from({ length: 15 }, (_, index) => index + 10).map(size => <option key={size} value={size}>{size}px</option>)}
        </select>
      </label>
      <button type="button" onClick={reset} style={{ ...btnStyle, marginTop: 12 }}>恢复默认字号</button>
    </Field>
  </div>;
}
