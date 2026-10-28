import { defineConfig } from 'vitest/config';
import applicationConfig from '../vite.config';

/** The workspace foundation has a stricter gate than unrelated application features. */
export default defineConfig(async environment => {
  const config = await applicationConfig(environment);
  return { ...config, test: { ...config.test, coverage: { ...config.test?.coverage,
    include: [
      'src/ui/layout/resourcePlacements.ts',
      'src/app/bootstrap/sharedStartupTask.ts',
      'src/core/paneTree.ts',
      'src/core/paneLayout.ts',
      'src/features/workspace/model/workbench.ts',
      'src/features/workspace/model/windowLayout.ts',
      'src/features/workspace/model/workspaceResources.ts',
      'src/features/workspace/model/workspaceHistory.ts',
      'src/features/workspace/stores/workbench.ts',
      'src/features/workspace/stores/paneWorkspace.ts',
      'src/features/workspace/services/workbench.ts',
      'src/features/workspace/services/workspaceResources.ts',
      'src/features/workspace/services/workspaceHistory.ts',
      'src/features/workspace/stores/workbenchFeedback.ts',
      'src/features/workspace/hooks/useWorkspaceContainerTabs.tsx',
    ],
    exclude: ['src/**/*.test.*', 'src/**/__tests__/**'],
    reportsDirectory: 'coverage-workbench', reporter: ['text', 'json', 'json-summary', 'html'], reportOnFailure: true,
    thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
  } } };
});
