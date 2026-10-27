import { describe, expect, it, vi } from 'vitest';
import { createApplicationBootstrap, type ApplicationBootstrapDependencies } from '@app/bootstrap/applicationBootstrap';

function createDependencies(): ApplicationBootstrapDependencies {
  return {
    configureAgentStream: vi.fn(),
    refreshAiConfig: vi.fn(),
    refreshToolPolicy: vi.fn(),
    subscribeAutoTitle: vi.fn(() => vi.fn()),
    restoreWorkspace: vi.fn(),
    loadWorkspaceDirs: vi.fn(),
    hydrateHistory: vi.fn(),
  };
}

describe('createApplicationBootstrap', () => {
  it('按固定顺序启动所有应用级任务', () => {
    const order: string[] = [];
    const instrumented = createDependencies();
    const names: Array<keyof ApplicationBootstrapDependencies> = [
      'configureAgentStream',
      'refreshAiConfig',
      'refreshToolPolicy',
      'subscribeAutoTitle',
      'restoreWorkspace',
      'loadWorkspaceDirs',
      'hydrateHistory',
    ];
    for (const name of names) {
      if (name === 'subscribeAutoTitle') {
        instrumented[name] = vi.fn(() => {
          order.push(name);
          return vi.fn();
        });
      } else {
        instrumented[name] = vi.fn(() => {
          order.push(name);
          return undefined;
        });
      }
    }

    createApplicationBootstrap(instrumented);

    expect(order).toEqual([
      'configureAgentStream',
      'refreshAiConfig',
      'refreshToolPolicy',
      'subscribeAutoTitle',
      'restoreWorkspace',
      'loadWorkspaceDirs',
      'hydrateHistory',
    ]);
  });

  it('销毁时逆序清理，并且清理操作幂等', () => {
    const deps = createDependencies();
    const firstCleanup = vi.fn();
    deps.subscribeAutoTitle = vi.fn(() => firstCleanup);

    const dispose = createApplicationBootstrap(deps);
    dispose();
    dispose();

    expect(firstCleanup).toHaveBeenCalledOnce();
  });

  it('隔离启动任务错误，不阻断其他初始化', () => {
    const deps = createDependencies();
    const errors: string[] = [];
    deps.refreshAiConfig = vi.fn(() => {
      throw new Error('boom');
    });
    const dispose = createApplicationBootstrap(deps, {
      onError: (name) => errors.push(name),
    });

    expect(deps.restoreWorkspace).toHaveBeenCalledOnce();
    expect(errors).toEqual(['refresh AI configuration']);
    dispose();
  });
});
