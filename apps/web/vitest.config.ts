import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['test/setup.tsx'],
      testTimeout: 30000, // ponytail: 19 worker paralel di laptop lambat; tes login sendirian ~5s
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        // Komponen hasil generate shadcn/mapcn tidak ditulis tangan; entry point hanya merender App.
        exclude: ['src/components/ui/**', 'src/main.tsx'],
        thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  }),
);
