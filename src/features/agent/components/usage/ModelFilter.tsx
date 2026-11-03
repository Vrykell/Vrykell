import { t } from '@i18n';
import Select from '@ui/fields/Select';
import { Grid, iconSizes } from '@ui/icons';
import { ALL_FILTER } from '../../hooks/useUsageStats';
import { vendorMark } from './vendorColor';

export default function ModelFilter({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  const items = [
    { value: ALL_FILTER, label: t('All'), icon: <Grid size={iconSizes.compact} color="var(--text-muted)" /> },
    ...options.map(model => {
      const mark = vendorMark('', model);
      const Glyph = mark.icon;
      return { value: model, label: model, icon: <Glyph size={iconSizes.compact} color={mark.color} /> };
    }),
  ];
  return <Select aria-label={t('Model')} data-testid="usage-model-filter" value={value} options={items}
    onChange={onChange} style={{ maxWidth: 220 }} />;
}
