import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Explicit aliases rather than relying on the node_modules workspace symlink,
 * so resolution is identical whether vitest runs from the repo root or from
 * this workspace.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@nsh/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@nsh/core-logic': path.resolve(__dirname, '../../packages/core-logic/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
