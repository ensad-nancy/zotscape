import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/zotscape/' : '/',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.ZOTSCAPE_PORT || 5173),
    open: false,
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
});
