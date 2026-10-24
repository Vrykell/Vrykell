import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { SplitDivider, type PaneRect, type PaneEdges } from '@ui/layout/SplitPane';

export interface SplitCell { id: string; rect: PaneRect; inner: PaneEdges }
export interface SplitLine { aId: string; bId: string; dir: 'row' | 'col'; ratio: number; rect: PaneRect; region: PaneRect }

const SplitPaneLayout = forwardRef<HTMLDivElement, {
  cells: SplitCell[]; dividers: SplitLine[]; renderPane: (cell: SplitCell) => ReactNode; onRatio: (first: string, second: string, ratio: number) => void;
  minWidth?: number; minHeight?: number; thickness?: number; dividerTestPrefix?: string; style?: CSSProperties; children?: ReactNode;
}>(function SplitPaneLayout({ cells, dividers, renderPane, onRatio, minWidth, minHeight, thickness, dividerTestPrefix, style, children }, ref) {
  return <div ref={ref} data-split-layout style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, ...style }}>
    {cells.map(cell => <div key={cell.id} data-split-cell={cell.id} style={{ position: 'absolute', left: `${cell.rect.x * 100}%`, top: `${cell.rect.y * 100}%`, width: `${cell.rect.w * 100}%`, height: `${cell.rect.h * 100}%`, display: 'flex', minWidth: 0, minHeight: 0 }}>{renderPane(cell)}</div>)}
    {dividers.map(line => <SplitDivider key={`${line.aId}:${line.bId}`} {...line} minWidth={minWidth} minHeight={minHeight} thickness={thickness}
      testId={dividerTestPrefix ? `${dividerTestPrefix}-${line.dir}` : undefined} onRatio={ratio => onRatio(line.aId, line.bId, ratio)} />)}
    {children}
  </div>;
});
export default SplitPaneLayout;
