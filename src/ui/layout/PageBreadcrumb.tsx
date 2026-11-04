import { Fragment, type ReactNode } from 'react';
import { t } from '@i18n';
import { ChevronRight } from '@ui/icons';
import './PageBreadcrumb.css';

export default function PageBreadcrumb({ ancestors, current, meta, className = '' }: {
  ancestors: Array<{ label: string; onClick: () => void }>;
  current: string;
  meta?: ReactNode;
  className?: string;
}) {
  return <nav aria-label={t('Page navigation')} className={`page-breadcrumb ${className}`}>
    {ancestors.map((item, index) => <Fragment key={`${index}-${item.label}`}>
      <button type="button" data-subtle data-tip={item.label} onClick={item.onClick}>{item.label}</button>
      <ChevronRight size={18} aria-hidden="true" />
    </Fragment>)}
    <h2 aria-current="page">{current}</h2>{meta && <span className="page-breadcrumb-meta">{meta}</span>}
  </nav>;
}
