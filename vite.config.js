import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// proxy /odata → CAP dev server (cds watch @ 4004)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/odata': 'http://localhost:4004'
    }
  }
})
