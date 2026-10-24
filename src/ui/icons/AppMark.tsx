import { forwardRef, useId } from 'react';
import { iconSizes, type AppIconProps } from '@ui/icons';

const AppMark = forwardRef<SVGSVGElement, AppIconProps & { colored?: boolean }>(function AppMark({ size = iconSizes.row, style, colored = true, ...props }, ref) {
  const mask = useId();
  return <svg {...props} ref={ref} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-app-mark="true" style={{ flexShrink: 0, ...style }}>
    {colored ? <image href="/app-icon.svg" width="24" height="24" /> : <>
      <defs>
        <mask id={mask} style={{ maskType: 'alpha' }}><image href="/app-icon.svg" width="24" height="24" /></mask>
      </defs>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </>}
  </svg>;
});
export default AppMark;
