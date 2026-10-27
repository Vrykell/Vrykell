/**
 * Application startup orchestration.
 *
 * This layer owns startup order, async error isolation and lifecycle cleanup. Business
 * initialization arrives through dependency injection so the App component does not depend on
 * every infrastructure module directly.
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
  console.warn(`[application] ${taskName} failed to initialize:`, error);
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

/** Create an application runtime that can be tested and disposed once. */
export function createApplicationBootstrap(
  dependencies: ApplicationBootstrapDependencies,
  options: ApplicationBootstrapOptions = {},
): () => void {
  const onError = options.onError ?? defaultErrorHandler;
  const cleanups: ApplicationCleanup[] = [];
  let disposed = false;

  runTask('configure agent stream', dependencies.configureAgentStream, onError);
  runTask('refresh AI configuration', dependencies.refreshAiConfig, onError);
  runTask('refresh tool policy', dependencies.refreshToolPolicy, onError);
  registerCleanup(cleanups, 'initialize automatic titles', dependencies.subscribeAutoTitle, onError);
  runTask('restore workspace sessions', dependencies.restoreWorkspace, onError);
  runTask('load workspace directories', dependencies.loadWorkspaceDirs, onError);
  runTask('restore command history', dependencies.hydrateHistory, onError);

  return () => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        onError('dispose application runtime', error);
      }
    }
  };
}
