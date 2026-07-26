import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER_PORT = process.env['PORT'] ?? '8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nsh/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [__dirname, path.resolve(__dirname, '../contracts')],
    },
    // Design §13: proxying /api to the server port means there is no CORS
    // configuration anywhere in this project.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
});
