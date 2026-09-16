import CommandPalette from '@/components/CommandPalette';
import GlobalSearch from '@features/search/components/GlobalSearch';
import NewTabModal from '@/components/NewTabModal';
import ToastContainer from '@/components/Toast';
import { useUiStore } from '@shared/ui';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';

interface ApplicationOverlaysProps {
  onPickSplit: (spec: TerminalSpec) => void;
}

/** 应用级弹层集合，避免 App 壳直接管理每个弹层的状态细节。 */
export default function ApplicationOverlays({ onPickSplit }: ApplicationOverlaysProps) {
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  const globalSearchOpen = useUiStore((state) => state.globalSearchOpen);
  const splitPickerOpen = useUiStore((state) => state.splitPickerOpen);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const setGlobalSearchOpen = useUiStore((state) => state.setGlobalSearchOpen);
  const closeSplitPicker = useUiStore((state) => state.closeSplitPicker);

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
      <NewTabModal open={splitPickerOpen} onClose={closeSplitPicker} onPick={onPickSplit} />
      <ToastContainer />
    </>
  );
}
