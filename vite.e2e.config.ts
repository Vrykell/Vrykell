import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'path';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        '@tauri-apps/api/core': resolve(__dirname, 'e2e/bridge/client.js'),
        '@tauri-apps/api/event': resolve(__dirname, 'e2e/bridge/client.js'),
      },
    },
  }),
);
