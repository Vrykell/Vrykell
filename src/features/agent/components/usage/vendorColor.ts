/**
 * vendorColor — the brand hue and drawn mark for the vendor a usage row belongs to.
 *
 * Delegates to the shared vendor table (see modelIcon): the model identifier decides the family
 * first (a gateway can serve `gpt-4o-mini` under an OpenAI-compatible provider), then the provider
 * kind, then a neutral ink. The hue lives in the theme palette (`--brand-*`) where one is defined.
 */
import { modelVendorInfo } from '@features/agent/components/modelIcon';
import type { AppIcon } from '@ui/icons';

export interface VendorMark {
  /** CSS colour for the mark. */
  color: string;
  /** Vendor name for the mark's tooltip. */
  label: string;
  /** Drawn brand mark shown in front of the row. */
  icon: AppIcon;
}

export function vendorMark(provider: string, model: string): VendorMark {
  const info = modelVendorInfo(provider, model, '');
  return { color: info.hue, label: info.label, icon: info.mark };
}
