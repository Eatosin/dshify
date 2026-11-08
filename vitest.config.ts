import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The plugin package imports its published dependency by name; tests run
      // against the working tree instead of a packed tarball.
      '@eatosin/dshify': path.resolve(process.cwd(), 'src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
