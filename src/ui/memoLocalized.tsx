import { memo, type ComponentType } from 'react';
import { useT } from '@i18n';

export function memoLocalized<Props extends object>(Component: ComponentType<Props>) {
  return memo(function LocalizedSurface(props: Props) {
    useT();
    return <Component {...props} />;
  });
}
