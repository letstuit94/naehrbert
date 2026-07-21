import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true so the dev server is reachable from outside a docker
  // container (e.g. `docker compose up` + a port mapping), not just localhost.
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
