import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    // Same-origin API in development so HttpOnly SameSite cookies just work
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] },
      },
    },
  },
});
