import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_ORIGIN = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: SERVER_ORIGIN, ws: true, changeOrigin: true },
    },
  },
});
