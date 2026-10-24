import { t } from '@i18n';
import { ALL_FILTER } from '../../hooks/useUsageStats';
import { vendorMark } from './vendorColor';

export default function ModelFilter({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return <div className="usage-model-filter" role="group" aria-label={t('Model')}>
    <button type="button" data-subtle className="usage-model-chip" data-testid="usage-model-all"
      aria-pressed={value === ALL_FILTER} onClick={() => onChange(ALL_FILTER)}>{t('All')}</button>
    {options.map(model => {
      const mark = vendorMark('', model);
      const Glyph = mark.icon;
      return <button key={model} type="button" data-subtle className="usage-model-chip"
        data-testid={`usage-model-${model}`} aria-label={model} aria-pressed={value === model}
        data-tip={model} onClick={() => onChange(value === model ? ALL_FILTER : model)}>
        <Glyph size={14} color={mark.color} /><span>{model}</span>
      </button>;
    })}
  </div>;
}
