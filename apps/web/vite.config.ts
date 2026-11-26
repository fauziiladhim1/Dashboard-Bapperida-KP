import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000' } },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    sourcemap: false,
    // Chunk maplibre memang besar (~300KB gzip), tapi di-cache immutable dan hanya dimuat di halaman berpeta.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Pisah MapLibre (~800KB) ke chunk sendiri; hanya dimuat di halaman berpeta.
        // Recharts sengaja TIDAK dipisah: chunk 'charts' bernama menarik runtime React bersama (jsx-runtime)
        // ke dalamnya, lalu entry meng-import statis chunk itu -> index.html mem-preload recharts+d3 di halaman
        // login (FE-PERF-01). Dibiarkan, recharts ikut ke chunk dinamis OverviewPage dan hanya dimuat di /overview.
        // CSS maplibre dikecualikan: map.tsx meng-import CSS itu secara statis, dan bila CSS ikut chunk 'maplibre',
        // seluruh JS MapLibre (~290 KB) ikut dimuat statis di setiap halaman yang memakai komponen peta, padahal
        // import("maplibre-gl") di map.tsx sudah dinamis.
        manualChunks: (id) => (id.includes('maplibre-gl') && !id.endsWith('.css') ? 'maplibre' : undefined),
      },
    },
  },
});
