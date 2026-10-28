/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

// `base: './'` keeps the build portable: it works from any static host or sub-path
// (GitHub Pages, Netlify, Cloudflare Pages…) because routing is hash-based.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  // One ~155 kB (gzip) bundle, mostly React + React Router; fine for an installable app.
  build: { chunkSizeWarningLimit: 600 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
