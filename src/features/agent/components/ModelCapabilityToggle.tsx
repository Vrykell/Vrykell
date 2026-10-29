import { OutlineButton } from '@ui/actions/OutlineButton';
import { iconSizes } from '@ui/icons';
import { capabilityLabel, type ModelCapability } from '../model/capabilities';
import { MODEL_CAPABILITY_ICONS } from './ModelCapabilityBadge';

/** Capability selection shares one appearance across filters and model declarations. */
export function ModelCapabilityToggle({ capability, selected, onChange }: {
  capability: ModelCapability; selected: boolean; onChange: (selected: boolean) => void;
}) {
  const Icon = MODEL_CAPABILITY_ICONS[capability];
  return <OutlineButton className="model-capability-toggle" aria-pressed={selected} onClick={() => onChange(!selected)}>
    <Icon size={iconSizes.compact} aria-hidden="true" />{capabilityLabel(capability)}
  </OutlineButton>;
}
