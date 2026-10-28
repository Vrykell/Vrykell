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
  it('starts every application-level task in a fixed order', () => {
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

  it('cleans up in reverse order on dispose and cleanup is idempotent', () => {
    const deps = createDependencies();
    const firstCleanup = vi.fn();
    deps.subscribeAutoTitle = vi.fn(() => firstCleanup);

    const dispose = createApplicationBootstrap(deps);
    dispose();
    dispose();

    expect(firstCleanup).toHaveBeenCalledOnce();
  });

  it('isolates startup task failures without blocking other initialization', () => {
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
