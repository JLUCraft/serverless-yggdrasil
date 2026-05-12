import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  publicDir: 'src/client/public',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      }
    }
  }
})
