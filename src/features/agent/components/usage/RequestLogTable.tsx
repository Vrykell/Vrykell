/**
 * RequestLogTable — one row per assistant turn, newest first.
 *
 * Columns follow the reference dashboard minus what we do not measure: time, provider, model,
 * fresh input, output, cache reads, steps and tool calls. The time cell shows the clock for
 * today and leads with the date for older rows; the full stamp is in the title.
 */
import { useState } from 'react';
import { t } from '@i18n';
import {
  formatCompact,
  formatLogFullTime,
  formatLogTime,
  formatTokens,
  freshInputTokens,
  paginate,
  type UsageRecord,
} from '@features/agent/model/usageStats';
import { usageTable } from './tableStyles';
import TablePager from './TablePager';
import VendorDot from './VendorDot';

export default function RequestLogTable({ rows }: { rows: UsageRecord[] }) {
  const [page, setPage] = useState(0);
  const paged = paginate(rows, page);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={usageTable.scroller}>
        <table style={usageTable.table} aria-label={t('Request log')}>
          <thead>
            <tr style={usageTable.headRow}>
              <th style={usageTable.th}>{t('Time')}</th>
              <th style={usageTable.th}>{t('Provider')}</th>
              <th style={usageTable.th}>{t('Model')}</th>
              <th style={usageTable.th}>{t('Fresh input')}</th>
              <th style={usageTable.th}>{t('Output')}</th>
              <th style={usageTable.th}>{t('Cache read')}</th>
              <th style={usageTable.th}>{t('Steps')}</th>
              <th style={usageTable.th}>{t('Tool calls')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td style={{ ...usageTable.td, ...usageTable.empty }} colSpan={8}>
                  {t('No usage was recorded in this range.')}
                </td>
              </tr>
            ) : paged.rows.map((record) => (
              <tr key={record.id} style={usageTable.row} data-testid="usage-log-row" data-model={record.model}>
                <td style={{ ...usageTable.td, ...usageTable.mono }} title={formatLogFullTime(record.at)}>
                  {formatLogTime(record.at)}
                </td>
                <td style={usageTable.td} title={record.provider}>{record.provider}</td>
                <td style={{ ...usageTable.td, ...usageTable.mono, ...usageTable.primary }} title={record.model}>
                  <VendorDot provider={record.provider} model={record.model} />{record.model}
                </td>
                <td style={usageTable.td} title={formatTokens(freshInputTokens(record))}>
                  {formatCompact(freshInputTokens(record))}
                </td>
                <td style={usageTable.td} title={formatTokens(record.outputTokens)}>
                  {formatCompact(record.outputTokens)}
                </td>
                <td style={usageTable.td} title={formatTokens(record.cachedInputTokens)}>
                  {formatCompact(record.cachedInputTokens)}
                </td>
                <td style={usageTable.td}>{record.steps}</td>
                <td style={usageTable.td}>{record.toolCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={paged} onPageChange={setPage} />
    </div>
  );
}
