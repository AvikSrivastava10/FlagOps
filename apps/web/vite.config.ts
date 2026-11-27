import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // `pnpm dev` runs the FlagOps server on its default port; the browser talks only to Vite.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
