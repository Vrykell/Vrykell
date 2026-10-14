/**
 * ProviderStatsTable / ModelStatsTable — the two aggregate views of the usage page.
 *
 * Same columns and conventions as the request log, grouped by provider or by model and sorted by
 * requests (heaviest first), with cache hit rate as the derived column.
 */
import { useState } from 'react';
import { t } from '@i18n';
import {
  cacheHitRate,
  formatCompact,
  formatTokens,
  paginate,
  type ModelUsageRow,
  type ProviderUsageRow,
} from '@features/agent/model/usageStats';
import { usageTable } from './tableStyles';
import TablePager from './TablePager';

/** Percent label: whole numbers above 99.9%, one decimal below. */
function hitRateLabel(hits: number, inputTokens: number): string {
  if (inputTokens <= 0) return '—';
  const percent = cacheHitRate({ inputTokens, cachedInputTokens: hits }) * 100;
  return `${percent >= 99.95 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function ProviderTable({ rows }: { rows: ProviderUsageRow[] }) {
  const [page, setPage] = useState(0);
  const paged = paginate(rows, page);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={usageTable.scroller}>
        <table style={usageTable.table} aria-label={t('By provider')}>
          <thead>
            <tr style={usageTable.headRow}>
              <th style={usageTable.th}>{t('Provider')}</th>
              <th style={usageTable.th}>{t('Requests')}</th>
              <th style={usageTable.th}>{t('Tokens')}</th>
              <th style={usageTable.th}>{t('Fresh input')}</th>
              <th style={usageTable.th}>{t('Output')}</th>
              <th style={usageTable.th}>{t('Cache hit rate')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td style={{ ...usageTable.td, ...usageTable.empty }} colSpan={6}>
                  {t('No usage was recorded in this range.')}
                </td>
              </tr>
            ) : paged.rows.map((row) => (
              <tr key={row.provider} style={usageTable.row} data-testid="usage-provider-row" data-provider={row.provider}>
                <td style={{ ...usageTable.td, ...usageTable.primary }} title={row.provider}>{row.provider}</td>
                <td style={usageTable.td}>{formatTokens(row.turns)}</td>
                <td style={usageTable.td} title={formatTokens(row.totalTokens)}>{formatCompact(row.totalTokens)}</td>
                <td style={usageTable.td} title={formatTokens(row.inputTokens - row.cachedInputTokens)}>
                  {formatCompact(Math.max(0, row.inputTokens - row.cachedInputTokens))}
                </td>
                <td style={usageTable.td} title={formatTokens(row.outputTokens)}>{formatCompact(row.outputTokens)}</td>
                <td style={usageTable.td}>{hitRateLabel(row.cachedInputTokens, row.inputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={paged} onPageChange={setPage} />
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelUsageRow[] }) {
  const [page, setPage] = useState(0);
  const paged = paginate(rows, page);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={usageTable.scroller}>
        <table style={usageTable.table} aria-label={t('By model')}>
          <thead>
            <tr style={usageTable.headRow}>
              <th style={usageTable.th}>{t('Model')}</th>
              <th style={usageTable.th}>{t('Provider')}</th>
              <th style={usageTable.th}>{t('Requests')}</th>
              <th style={usageTable.th}>{t('Tokens')}</th>
              <th style={usageTable.th}>{t('Fresh input')}</th>
              <th style={usageTable.th}>{t('Output')}</th>
              <th style={usageTable.th}>{t('Cache hit rate')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td style={{ ...usageTable.td, ...usageTable.empty }} colSpan={7}>
                  {t('No usage was recorded in this range.')}
                </td>
              </tr>
            ) : paged.rows.map((row) => (
              <tr key={row.key} style={usageTable.row} data-testid="usage-model-row" data-model={row.model}>
                <td style={{ ...usageTable.td, ...usageTable.mono, ...usageTable.primary }} title={row.model}>{row.model}</td>
                <td style={usageTable.td} title={row.provider}>{row.provider}</td>
                <td style={usageTable.td}>{formatTokens(row.turns)}</td>
                <td style={usageTable.td} title={formatTokens(row.totalTokens)}>{formatCompact(row.totalTokens)}</td>
                <td style={usageTable.td} title={formatTokens(row.inputTokens - row.cachedInputTokens)}>
                  {formatCompact(Math.max(0, row.inputTokens - row.cachedInputTokens))}
                </td>
                <td style={usageTable.td} title={formatTokens(row.outputTokens)}>{formatCompact(row.outputTokens)}</td>
                <td style={usageTable.td}>{hitRateLabel(row.cachedInputTokens, row.inputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={paged} onPageChange={setPage} />
    </div>
  );
}

export function ProviderStatsTable({ rows }: { rows: ProviderUsageRow[] }) {
  return <ProviderTable rows={rows} />;
}

export function ModelStatsTable({ rows }: { rows: ModelUsageRow[] }) {
  return <ModelTable rows={rows} />;
}
