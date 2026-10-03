import { useRef } from 'react';
import { useDockStore } from '@features/workspace';
import DockButton from '@features/workspace/components/DockButton';
import { useToastStore } from '@ui/Toast';

/** Navigation actions switch content in the adjacent left sidebar. */
export default function ActivityBar() {
  const leftZone = useDockStore(s => s.leftZone);
  const leftPanels = useDockStore(s => s.leftPanels);
  const dragId = useRef<string | null>(null);
  const ids = leftZone.filter(id => id !== 'chat');

  return (
    <nav className="workspace-activity-bar" aria-label="工作区导航">
      <div className="workspace-activity-actions">
        {ids.map(id => (
          <DockButton key={id} panelId={id} active={leftPanels.includes(id)}
            onClick={() => {
              const dock = useDockStore.getState();
              const wasOpen = dock.leftPanels.includes(id);
              dock.togglePanel('left', id);
              const next = useDockStore.getState();
              if (!wasOpen && !next.leftPanels.includes(id) && !next.rightPanels.includes(id)) {
                useToastStore.getState().addToast('窗口空间不足，请加宽窗口或减少分屏', 'info');
              }
            }}
            onDragStart={e => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
            onDragEnd={() => { dragId.current = null; }}
            onDragOver={e => { if (dragId.current) e.preventDefault(); }}
            onDrop={e => {
              e.preventDefault();
              const source = dragId.current;
              dragId.current = null;
              if (!source || source === id) return;
              useDockStore.getState().moveButton(source, 'left', leftZone.indexOf(id));
            }}
          />
        ))}
      </div>
    </nav>
  );
}
