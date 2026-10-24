import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';

function notificationRegion() {
  let region = document.getElementById('app-notifications');
  if (!region) {
    region = document.createElement('section');
    region.id = 'app-notifications';
    region.className = 'notification-region';
    region.setAttribute('aria-label', t('Notifications'));
    document.body.append(region);
  }
  return region;
}

export default function NotificationPortal({ children, followOwner = true }: { children: ReactNode; followOwner?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const sourceId = useId();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    const region = notificationRegion(); setTarget(region);
    const ancestors: HTMLElement[] = [];
    for (let element = anchor.current?.parentElement; element; element = element.parentElement) ancestors.push(element);
    const update = () => setVisible(!followOwner || ancestors.every(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true'
      && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'));
    update();
    const observer = new MutationObserver(update);
    if (followOwner) for (const element of ancestors) observer.observe(element, { attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden', 'class'] });
    return () => {
      observer.disconnect();
      queueMicrotask(() => { if (!region.childElementCount) region.remove(); });
    };
  }, [followOwner]);
  return <><span ref={anchor} data-notification-source={sourceId} hidden aria-hidden="true" />{target && visible && createPortal(
    <div className="notification-slot" data-notification-source-id={sourceId}>{children}</div>, target,
  )}</>;
}
