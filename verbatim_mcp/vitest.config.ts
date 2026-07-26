import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The Next.js widget app has its own toolchain and its own tsconfig.
    exclude: ['node_modules', 'dist', 'src/widgets/**'],
  },
});
