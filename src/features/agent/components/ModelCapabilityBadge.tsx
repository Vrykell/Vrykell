import { EyeSmall, LightbulbSmall, SearchSmall, WrenchSmall, iconSizes, type AppIcon } from '@ui/icons';
import { t } from '@i18n';
import { capabilityLabel, type ModelCapability } from '../model/capabilities';

export const MODEL_CAPABILITY_ICONS: Record<ModelCapability, AppIcon> = {
  vision: EyeSmall,
  reasoning: LightbulbSmall,
  tools: WrenchSmall,
  search: SearchSmall,
};

export function ModelCapabilityBadge({ capability, supported }: { capability: ModelCapability; supported: boolean }) {
  if (!supported) return null;
  const Icon = MODEL_CAPABILITY_ICONS[capability];
  const label = t('{{capability}} supported', { capability: capabilityLabel(capability) });
  return (
    <span
      className="model-capability-mark"
      data-testid={`model-cap-${capability}`}
      data-capability={capability}
      data-supported={supported}
      role="img"
      aria-label={label}
      data-tip={label}>
      <Icon size={iconSizes.compact} aria-hidden="true" />
    </span>
  );
}
