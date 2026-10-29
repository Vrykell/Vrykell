import { BrainCircuit, Eye, Globe, Wrench, type AppIcon } from '@ui/icons';
import { t } from '@i18n';
import { capabilityLabel, type ModelCapability } from '../model/capabilities';

export const MODEL_CAPABILITY_ICONS: Record<ModelCapability, AppIcon> = {
  vision: Eye, reasoning: BrainCircuit, tools: Wrench, search: Globe,
};

export function ModelCapabilityBadge({ capability, supported }: { capability: ModelCapability; supported: boolean }) {
  const Icon = MODEL_CAPABILITY_ICONS[capability];
  const label = t(supported ? '{{capability}} supported' : '{{capability}} not supported', { capability: capabilityLabel(capability) });
  return <span className="model-cap-chip" data-testid={`model-cap-${capability}`} data-supported={supported}
    role="img" aria-label={label} data-tip={label}><Icon size={14} aria-hidden="true" /></span>;
}
