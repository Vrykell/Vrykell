/** 应用级 UI 状态公开入口，屏蔽 Dock 和弹层状态的具体 Store 实现。 */
export * from '@features/workspace/stores/ui';
export * from '@features/workspace/stores/dock';
export { useDockDragStore } from '@features/workspace/stores/dockDrag';
