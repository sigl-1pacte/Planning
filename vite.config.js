import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  build: { outDir: '../../dist/ui', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
