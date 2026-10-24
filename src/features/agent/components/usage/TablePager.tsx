/**
 * TablePager — row count and page stepping under a usage table.
 *
 * Keeps the reference's quiet footer: the totals on the left, previous/next on the right, and
 * nothing when a single page covers everything.
 */
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { ArrowLeft, ArrowRight, iconSizes } from '@ui/icons';
import type { UsagePage } from '@features/agent/model/usageStats';

export default function TablePager({ page, onPageChange }: {
  page: UsagePage<unknown>;
  onPageChange: (next: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '8px 8px 2px', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)',
    }}>
      <span data-testid="usage-table-total">{t('{{count}} records', { count: page.total })}</span>
      {page.totalPages > 1 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconButton compact data-testid="usage-page-prev" disabled={page.page === 0}
            aria-label={t('Previous page')} data-tip={t('Previous page')} onClick={() => onPageChange(page.page - 1)}>
            <ArrowLeft size={iconSizes.compact} />
          </IconButton>
          <span data-testid="usage-page-label" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('Page {{page}} / {{total}}', { page: page.page + 1, total: page.totalPages })}
          </span>
          <IconButton compact data-testid="usage-page-next" disabled={page.page >= page.totalPages - 1}
            aria-label={t('Next page')} data-tip={t('Next page')} onClick={() => onPageChange(page.page + 1)}>
            <ArrowRight size={iconSizes.compact} />
          </IconButton>
        </span>
      )}
    </div>
  );
}
