/**
 * 应用启动编排层。
 *
 * 这里仅负责启动顺序、异步错误隔离和生命周期清理；具体业务初始化
 * 通过依赖注入提供，避免 App 组件直接依赖所有基础设施模块。
 */

export type ApplicationTask = () => void | Promise<void>;
export type ApplicationCleanup = () => void;

export interface ApplicationBootstrapDependencies {
  configureAgentStream: ApplicationTask;
  refreshAiConfig: ApplicationTask;
  refreshToolPolicy: ApplicationTask;
  subscribeAutoTitle: () => ApplicationCleanup;
  restoreWorkspace: ApplicationTask;
  loadWorkspaceDirs: ApplicationTask;
  hydrateHistory: ApplicationTask;
}

export interface ApplicationBootstrapOptions {
  onError?: (taskName: string, error: unknown) => void;
}

function defaultErrorHandler(taskName: string, error: unknown): void {
  console.warn(`[application] ${taskName} 初始化失败:`, error);
}

function runTask(
  taskName: string,
  task: ApplicationTask,
  onError: (taskName: string, error: unknown) => void,
): void {
  try {
    Promise.resolve(task()).catch((error: unknown) => onError(taskName, error));
  } catch (error) {
    onError(taskName, error);
  }
}

function registerCleanup(
  cleanups: ApplicationCleanup[],
  taskName: string,
  factory: () => ApplicationCleanup,
  onError: (taskName: string, error: unknown) => void,
): void {
  try {
    cleanups.push(factory());
  } catch (error) {
    onError(taskName, error);
  }
}

/** 创建一次可测试、可销毁的应用运行时。 */
export function createApplicationBootstrap(
  dependencies: ApplicationBootstrapDependencies,
  options: ApplicationBootstrapOptions = {},
): () => void {
  const onError = options.onError ?? defaultErrorHandler;
  const cleanups: ApplicationCleanup[] = [];
  let disposed = false;

  runTask('配置 Agent 流', dependencies.configureAgentStream, onError);
  runTask('刷新 AI 配置', dependencies.refreshAiConfig, onError);
  runTask('刷新工具权限', dependencies.refreshToolPolicy, onError);
  registerCleanup(cleanups, '初始化智能标题', dependencies.subscribeAutoTitle, onError);
  runTask('恢复工作区会话', dependencies.restoreWorkspace, onError);
  runTask('加载工作区目录', dependencies.loadWorkspaceDirs, onError);
  runTask('恢复命令历史', dependencies.hydrateHistory, onError);

  return () => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        onError('清理应用运行时', error);
      }
    }
  };
}
