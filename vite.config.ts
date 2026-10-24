import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Icons compiles `~icons/<collection>/<name>` imports at build time, so only
  // the shell brand marks we actually use end up in the bundle.
  plugins: [react(), Icons({ compiler: "jsx", jsx: "react" }), {
    name: "embedded-control-messages",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.replaceAll("\\", "/").includes("/node_modules/monaco-editor/esm/") && /(?:^|\/)nls\.js$/.test(source)) {
        return `${sourceRoot}/ui/editor/code/localize.ts`;
      }
    },
  }],
  // Embedded controls use the application catalog rather than a separate language setting.
  optimizeDeps: { exclude: ["monaco-editor", "monaco-vim"] },

  // Keep runtime imports aligned with tsconfig paths in Vite and Vitest.
  resolve: {
    alias: {
      "monaco-vim": fileURLToPath(new URL("./node_modules/monaco-vim/dist/index.mjs", import.meta.url)),
      "@app": `${sourceRoot}/app`,
      "@config": `${sourceRoot}/config`,
      "@core": `${sourceRoot}/core`,
      "@features": `${sourceRoot}/features`,
      "@i18n": `${sourceRoot}/i18n`,
      "@platform": `${sourceRoot}/platform`,
      "@ui": `${sourceRoot}/ui`,
      "@utils": `${sourceRoot}/utils`,
      "@": sourceRoot,
    },
  },

  test: {
    // Test discovery is limited to project source, excluding downloaded design references.
    include: ["src/**/*.{test,spec}.{ts,tsx,js,jsx}"],
    environment: "jsdom",
    setupFiles: "./src/test-utils/setup.ts",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // 覆盖范围 = 核心逻辑（Feature、平台适配、状态、主题、终端管线）；
      // 纯展示组件仍由交互测试和 E2E 覆盖，不纳入单元测试门槛。
      include: [
        "src/config/theme/**/*.{ts,tsx}",
        "src/features/*/stores/**/*.{ts,tsx}",
        "src/features/agent/**/*.{ts,tsx}",
        "src/features/files/**/*.{ts,tsx}",
        "src/features/settings/model/terminalTheme.ts",
        "src/features/terminal/services/pipeline/**/*.{ts,tsx}",
        "src/platform/**/*.{ts,tsx}",
        "src/app/providers/ThemeProvider.tsx",
        "src/utils/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/app/providers/**",
        "src/features/*/components/**",
        "src/features/*/hooks/**",
        "src/features/files/components/**",
        "src/features/agent/model/standardSkills.ts",
        "src/features/agent/tools/remember.ts",
        "src/features/agent/tools/spawnAgent.ts",
        "src/**/*.test.*",
        "src/**/__tests__/**",
        "src/test-utils/**",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
