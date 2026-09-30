import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 开发服务器将 /api 代理到后端 Express（默认 8787）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
