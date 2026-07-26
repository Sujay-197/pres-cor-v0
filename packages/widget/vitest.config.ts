import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Test-only config, kept separate from vite.config.ts (the build config).
 * globals:true lets the colocated *.test.ts files use bare test/expect, and the
 * alias mirrors the build so tests resolve @nsh/contracts to source.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@nsh/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
