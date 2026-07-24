import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@api': resolve(__dirname, 'src/api'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // Allow Tauri dev server to connect
    host: '127.0.0.1',
  },
});
