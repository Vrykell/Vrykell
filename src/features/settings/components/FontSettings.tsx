import { useTypographyStore } from '@config/typography';
import Select from '@ui/Select';
import { Field, btnStyle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const pageSizes = Array.from({ length: 9 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));
const terminalSizes = Array.from({ length: 15 }, (_, index) => ({ value: index + 10, label: `${index + 10}px` }));

export default function FontSettings() {
  const { uiFontSize, terminalFontSize, update, reset } = useTypographyStore();
  const { save } = useSettingsSave();
  return <div aria-label="字号设置">
    <Field title="页面字号" description="调整整个应用的界面文字大小。">
      <div className="settings-font-row">
        <Select aria-label="页面字号" value={uiFontSize} options={pageSizes} onChange={uiFontSize => { void save(() => update({ uiFontSize })); }} style={{ width: 110 }} />
      </div>
    </Field>
    <Field title="终端字号" description="调整终端输入与输出文字大小。">
      <div className="settings-font-row">
        <Select aria-label="终端字号" value={terminalFontSize} options={terminalSizes} onChange={terminalFontSize => { void save(() => update({ terminalFontSize })); }} style={{ width: 110 }} />
      </div>
      <button type="button" onClick={reset} style={{ ...btnStyle, marginTop: 12 }}>恢复默认字号</button>
    </Field>
  </div>;
}
