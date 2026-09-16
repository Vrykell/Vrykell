import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Keep runtime imports aligned with tsconfig paths in Vite and Vitest.
  resolve: {
    alias: {
      "@app": `${sourceRoot}/app`,
      "@shared": `${sourceRoot}/shared`,
      "@widgets": `${sourceRoot}/widgets`,
      "@features": `${sourceRoot}/features`,
      "@entities": `${sourceRoot}/entities`,
      "@": sourceRoot,
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // 覆盖范围 = 核心逻辑（agent/工具/API/文件/库/状态/主题/终端管线）；
      // UI 壳层（聊天/设置/组件/终端视图/搜索/SSH/下载/开发页）属渲染层，不在单测范围内
      include: [
        "src/agent/**/*.{ts,tsx}",
        "src/api/**/*.{ts,tsx}",
        "src/files/**/*.{ts,tsx}",
        "src/lib/**/*.{ts,tsx}",
        "src/stores/**/*.{ts,tsx}",
        "src/theme/**/*.{ts,tsx}",
        "src/terminal/pipeline/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/files/PanelFiles.tsx",
        "src/agent/standardSkills.ts",
        "src/agent/tools/remember.ts",
        "src/agent/tools/spawnAgent.ts",
        "src/**/*.test.*",
        "src/**/__tests__/**",
        "src/test/**",
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
