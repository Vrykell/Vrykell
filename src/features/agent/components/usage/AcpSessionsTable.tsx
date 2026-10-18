/**
 * AcpSessionsTable — the ACP tab of the records card: one row per server, what each reported.
 *
 * An ACP server reports its sessions (turns, tool calls, the context window in use and the
 * cumulative cost) and no per-turn token counts, so this tab has columns of its own instead of
 * faking token cells in the request log. A cell the protocol does not carry reads as an em dash.
 */
import { useState } from 'react';
import { t } from '@i18n';
import {
  formatCompact,
  formatLogFullTime,
  formatLogTime,
  formatTokens,
  paginate,
  type AcpUsageRecord,
} from '@features/agent/model/usageStats';
import HarnessBadge from '@features/agent/components/HarnessBadge';
import { usageTable } from './tableStyles';
import TablePager from './TablePager';

export default function AcpSessionsTable({ rows }: { rows: AcpUsageRecord[] }) {
  const [page, setPage] = useState(0);
  const paged = paginate(rows, page);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={usageTable.scroller}>
        <table style={usageTable.table} aria-label={t('ACP sessions')}>
          <thead>
            <tr style={usageTable.headRow}>
              <th style={usageTable.th}>{t('Server')}</th>
              <th style={usageTable.th}>{t('Turns')}</th>
              <th style={usageTable.th}>{t('Tool calls')}</th>
              <th style={usageTable.th}>{t('Context usage')}</th>
              <th style={usageTable.th}>{t('Cumulative cost')}</th>
              <th style={usageTable.th}>{t('Latest update')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td style={{ ...usageTable.td, ...usageTable.empty }} colSpan={6}>
                  {t('No ACP server has reported its sessions yet.')}
                </td>
              </tr>
            ) : paged.rows.map((row) => (
              <tr key={row.source} style={usageTable.row} data-testid="usage-acp-row" data-source={row.source}>
                <td style={{ ...usageTable.td, ...usageTable.primary }} title={row.source}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <HarnessBadge name={row.source} size={18} />
                    {row.source}
                  </span>
                </td>
                <td style={usageTable.td}>{formatTokens(row.turns)}</td>
                <td style={usageTable.td}>{formatTokens(row.toolCalls)}</td>
                <td style={usageTable.td} title={contextExact(row)}>
                  {contextLabel(row)}
                </td>
                <td style={usageTable.td} title={row.cost !== null ? `${row.cost.toFixed(4)} ${row.currency}`.trim() : undefined}>
                  {row.cost !== null ? `${row.cost.toFixed(4)}${row.currency ? ` ${row.currency}` : ''}` : '—'}
                </td>
                <td style={{ ...usageTable.td, ...usageTable.mono }} title={formatLogFullTime(row.at)}>
                  {formatLogTime(row.at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager page={paged} onPageChange={setPage} />
    </div>
  );
}

/** Compact pair for the cell, exact counts in the title. */
function contextLabel(row: AcpUsageRecord): string {
  if (row.contextSize > 0) return `${formatCompact(row.contextUsed)}/${formatCompact(row.contextSize)}`;
  return row.contextUsed > 0 ? formatCompact(row.contextUsed) : '—';
}

function contextExact(row: AcpUsageRecord): string | undefined {
  if (row.contextSize > 0) return `${formatTokens(row.contextUsed)} / ${formatTokens(row.contextSize)}`;
  return row.contextUsed > 0 ? formatTokens(row.contextUsed) : undefined;
}
