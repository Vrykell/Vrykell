import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import type { FluentIcon, FluentIconsProps } from '@fluentui/react-icons/headless';
import '@fluentui/react-icons/headless/styles.css';
import { ErrorCircle24Regular } from '@fluentui/react-icons/headless/svg/error-circle';
import { Archive24Regular } from '@fluentui/react-icons/headless/svg/archive';
import { ArrowLeft24Regular } from '@fluentui/react-icons/headless/svg/arrow-left';
import { ArrowUp24Regular } from '@fluentui/react-icons/headless/svg/arrow-up';
import { ArrowDown24Regular } from '@fluentui/react-icons/headless/svg/arrow-down';
import { Bot24Regular } from '@fluentui/react-icons/headless/svg/bot';
import { Brain24Regular } from '@fluentui/react-icons/headless/svg/brain';
import { BrainCircuit24Regular } from '@fluentui/react-icons/headless/svg/brain-circuit';
import { Checkmark24Regular } from '@fluentui/react-icons/headless/svg/checkmark';
import { CheckmarkCircle24Regular } from '@fluentui/react-icons/headless/svg/checkmark-circle';
import { ChevronDown24Regular } from '@fluentui/react-icons/headless/svg/chevron-down';
import { ChevronRight24Regular } from '@fluentui/react-icons/headless/svg/chevron-right';
import { ClipboardPaste24Regular } from '@fluentui/react-icons/headless/svg/clipboard-paste';
import { SplitVertical24Regular } from '@fluentui/react-icons/headless/svg/split-vertical';
import { KeyCommand24Regular } from '@fluentui/react-icons/headless/svg/key-command';
import { Copy24Regular } from '@fluentui/react-icons/headless/svg/copy';
import { DeveloperBoard24Regular } from '@fluentui/react-icons/headless/svg/developer-board';
import { ArrowDownload24Regular } from '@fluentui/react-icons/headless/svg/arrow-download';
import { MoreHorizontal24Regular } from '@fluentui/react-icons/headless/svg/more-horizontal';
import { Eye24Regular } from '@fluentui/react-icons/headless/svg/eye';
import { Document24Regular } from '@fluentui/react-icons/headless/svg/document';
import { FolderZip24Regular } from '@fluentui/react-icons/headless/svg/folder-zip';
import { DocumentCode16Regular } from '@fluentui/react-icons/headless/svg/document-code';
import { DocumentSettings20Regular } from '@fluentui/react-icons/headless/svg/document-settings';
import { DocumentImage20Regular } from '@fluentui/react-icons/headless/svg/document-image';
import { DocumentText24Regular } from '@fluentui/react-icons/headless/svg/document-text';
import { Filter24Regular } from '@fluentui/react-icons/headless/svg/filter';
import { Folder24Regular } from '@fluentui/react-icons/headless/svg/folder';
import { FolderOpen24Regular } from '@fluentui/react-icons/headless/svg/folder-open';
import { Branch24Regular } from '@fluentui/react-icons/headless/svg/branch';
import { Globe24Regular } from '@fluentui/react-icons/headless/svg/globe';
import { HardDrive24Regular } from '@fluentui/react-icons/headless/svg/hard-drive';
import { History24Regular } from '@fluentui/react-icons/headless/svg/history';
import { Image24Regular } from '@fluentui/react-icons/headless/svg/image';
import { Info24Regular } from '@fluentui/react-icons/headless/svg/info';
import { Keyboard24Regular } from '@fluentui/react-icons/headless/svg/keyboard';
import { ArrowClockwiseDashes24Regular } from '@fluentui/react-icons/headless/svg/arrow-clockwise-dashes';
import { FolderArrowRight24Regular } from '@fluentui/react-icons/headless/svg/folder-arrow-right';
import { ArrowExpand24Regular } from '@fluentui/react-icons/headless/svg/arrow-expand';
import { ArrowMinimize24Regular } from '@fluentui/react-icons/headless/svg/arrow-minimize';
import { Subtract24Regular } from '@fluentui/react-icons/headless/svg/subtract';
import { Desktop24Regular } from '@fluentui/react-icons/headless/svg/desktop';
import { WeatherMoon24Regular } from '@fluentui/react-icons/headless/svg/weather-moon';
import { Planet24Regular } from '@fluentui/react-icons/headless/svg/planet';
import { Color24Regular } from '@fluentui/react-icons/headless/svg/color';
import { Attach24Regular } from '@fluentui/react-icons/headless/svg/attach';
import { Edit24Regular } from '@fluentui/react-icons/headless/svg/edit';
import { Play24Regular } from '@fluentui/react-icons/headless/svg/play';
import { PlugConnected24Regular } from '@fluentui/react-icons/headless/svg/plug-connected';
import { Add24Regular } from '@fluentui/react-icons/headless/svg/add';
import { ArrowSync24Regular } from '@fluentui/react-icons/headless/svg/arrow-sync';
import { ArrowCounterclockwise24Regular } from '@fluentui/react-icons/headless/svg/arrow-counterclockwise';
import { ArrowClockwise24Regular } from '@fluentui/react-icons/headless/svg/arrow-clockwise';
import { Search24Regular } from '@fluentui/react-icons/headless/svg/search';
import { ServerLink24Regular } from '@fluentui/react-icons/headless/svg/server-link';
import { Settings24Regular } from '@fluentui/react-icons/headless/svg/settings';
import { ShieldError24Regular } from '@fluentui/react-icons/headless/svg/shield-error';
import { ShieldCheckmark24Regular } from '@fluentui/react-icons/headless/svg/shield-checkmark';
import { ShieldDismiss24Regular } from '@fluentui/react-icons/headless/svg/shield-dismiss';
import { Warning24Regular } from '@fluentui/react-icons/headless/svg/warning';
import { Options24Regular } from '@fluentui/react-icons/headless/svg/options';
import { Sparkle24Regular } from '@fluentui/react-icons/headless/svg/sparkle';
import { Square24Regular } from '@fluentui/react-icons/headless/svg/square';
import { TabDesktopMultiple24Regular } from '@fluentui/react-icons/headless/svg/tab-desktop-multiple';
import { WindowConsole20Regular } from '@fluentui/react-icons/headless/svg/window-console';
import { Star24Regular } from '@fluentui/react-icons/headless/svg/star';
import { BuildingShop24Regular } from '@fluentui/react-icons/headless/svg/building-shop';
import { WeatherSunny24Regular } from '@fluentui/react-icons/headless/svg/weather-sunny';
import { Delete24Regular } from '@fluentui/react-icons/headless/svg/delete';
import { ArrowUndo24Regular } from '@fluentui/react-icons/headless/svg/arrow-undo';
import { ArrowUpload24Regular } from '@fluentui/react-icons/headless/svg/arrow-upload';
import { Wrench24Regular } from '@fluentui/react-icons/headless/svg/wrench';
import { Dismiss24Regular } from '@fluentui/react-icons/headless/svg/dismiss';
import { DismissCircle24Regular } from '@fluentui/react-icons/headless/svg/dismiss-circle';
import { Flash24Regular } from '@fluentui/react-icons/headless/svg/flash';

export type AppIconProps = Omit<FluentIconsProps, 'ref'> & { size?: number | string };
export type AppIcon = ForwardRefExoticComponent<AppIconProps & RefAttributes<SVGSVGElement>>;

export const iconSizes = { navigation: 24, row: 20, control: 18, compact: 16 } as const;

/** Preserve native icon geometry while sharing sizing and theme inheritance. */
function createAppIcon(Icon: FluentIcon): AppIcon {
  const AppIcon = forwardRef<SVGSVGElement, AppIconProps>(({
    size = 24, color = 'currentColor', style, ...props
  }, ref) => createElement(Icon, {
    focusable: false,
    ...props,
    style: { width: props.width ?? size, height: props.height ?? size, color, flexShrink: 0, ...style },
    ref,
  }));
  AppIcon.displayName = Icon.displayName;
  return AppIcon;
}

export const AlertCircle = createAppIcon(ErrorCircle24Regular);
export const Archive = createAppIcon(Archive24Regular);
export const ArrowLeft = createAppIcon(ArrowLeft24Regular);
export const ArrowUp = createAppIcon(ArrowUp24Regular);
export const ArrowDown = createAppIcon(ArrowDown24Regular);
export const DollarSign: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function DollarSign({ size = 24, style, ...props }, ref) {
  return createElement('svg', { ...props, ref, viewBox: '0 0 24 24', fill: 'none',
    style: { width: size, height: size, flexShrink: 0, ...style } }, createElement('path', {
    d: 'M12 3v18M17 6.5C15.5 5 13.5 5 12 5c-3 0-5 1.5-5 3.5S9 12 12 12s5 1.5 5 3.5S15 19 12 19c-2 0-4-.5-5-2',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
  }));
});
export const Bot = createAppIcon(Bot24Regular);
export const Brain = createAppIcon(Brain24Regular);
export const BrainCircuit = createAppIcon(BrainCircuit24Regular);
export const Check = createAppIcon(Checkmark24Regular);
export const CheckCircle2 = createAppIcon(CheckmarkCircle24Regular);
export const ChevronDown = createAppIcon(ChevronDown24Regular);
export const ChevronRight = createAppIcon(ChevronRight24Regular);
export const ClipboardPaste = createAppIcon(ClipboardPaste24Regular);
export const Columns2 = createAppIcon(SplitVertical24Regular);
export const Command = createAppIcon(KeyCommand24Regular);
export const Copy = createAppIcon(Copy24Regular);
export const Cpu = createAppIcon(DeveloperBoard24Regular);
export const Download = createAppIcon(ArrowDownload24Regular);
export const Ellipsis = createAppIcon(MoreHorizontal24Regular);
export const Eye = createAppIcon(Eye24Regular);
export const File = createAppIcon(Document24Regular);
export const FileArchive = createAppIcon(FolderZip24Regular);
export const FileCode = createAppIcon(DocumentCode16Regular);
export const FileCog = createAppIcon(DocumentSettings20Regular);
export const FileImage = createAppIcon(DocumentImage20Regular);
export const FileText = createAppIcon(DocumentText24Regular);
export const Filter = createAppIcon(Filter24Regular);
export const Folder = createAppIcon(Folder24Regular);
export const FolderOpen = createAppIcon(FolderOpen24Regular);
export const GitBranch = createAppIcon(Branch24Regular);
export const Globe = createAppIcon(Globe24Regular);
export const HardDrive = createAppIcon(HardDrive24Regular);
export const History = createAppIcon(History24Regular);
export const Image = createAppIcon(Image24Regular);
export const Info = createAppIcon(Info24Regular);
export const Keyboard = createAppIcon(Keyboard24Regular);
export const Loader2 = createAppIcon(ArrowClockwiseDashes24Regular);
export const FolderArrowRight = createAppIcon(FolderArrowRight24Regular);
export const Maximize2 = createAppIcon(ArrowExpand24Regular);
export const Minimize2 = createAppIcon(ArrowMinimize24Regular);
export const Minus = createAppIcon(Subtract24Regular);
export const Monitor = createAppIcon(Desktop24Regular);
export const Moon = createAppIcon(WeatherMoon24Regular);
export const MoreHorizontal = createAppIcon(MoreHorizontal24Regular);
export const Orbit = createAppIcon(Planet24Regular);
export const Palette = createAppIcon(Color24Regular);
export const Paperclip = createAppIcon(Attach24Regular);
export const Pencil = createAppIcon(Edit24Regular);
export const Play = createAppIcon(Play24Regular);
export const Plug = createAppIcon(PlugConnected24Regular);
export const Plus = createAppIcon(Add24Regular);
export const RefreshCw = createAppIcon(ArrowSync24Regular);
export const RotateCcw = createAppIcon(ArrowCounterclockwise24Regular);
export const RotateCw = createAppIcon(ArrowClockwise24Regular);
export const Search = createAppIcon(Search24Regular);
export const Server = createAppIcon(ServerLink24Regular);
export const Settings = createAppIcon(Settings24Regular);
export const ShieldAlert = createAppIcon(ShieldError24Regular);
export const ShieldCheck = createAppIcon(ShieldCheckmark24Regular);
export const ShieldOff = createAppIcon(ShieldDismiss24Regular);
export const Skull = createAppIcon(Warning24Regular);
export const SlidersHorizontal = createAppIcon(Options24Regular);
export const Sparkles = createAppIcon(Sparkle24Regular);
export const Square = createAppIcon(Square24Regular);
export const SquareStack = createAppIcon(TabDesktopMultiple24Regular);
export const SquareTerminal = createAppIcon(WindowConsole20Regular);
export const Star = createAppIcon(Star24Regular);
export const Store = createAppIcon(BuildingShop24Regular);
export const Sun = createAppIcon(WeatherSunny24Regular);
export const Terminal = createAppIcon(WindowConsole20Regular);
export const Trash2 = createAppIcon(Delete24Regular);
export const TriangleAlert = createAppIcon(Warning24Regular);
export const Undo2 = createAppIcon(ArrowUndo24Regular);
export const Upload = createAppIcon(ArrowUpload24Regular);
export const Wrench = createAppIcon(Wrench24Regular);
export const X = createAppIcon(Dismiss24Regular);
export const CircleX = createAppIcon(DismissCircle24Regular);
export const Zap = createAppIcon(Flash24Regular);
