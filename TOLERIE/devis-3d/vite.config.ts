import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'

const API_PORT = 8787

/** En développement, `npm run dev` lance aussi le serveur de l'atelier (server/index.ts). */
function atelierServer(): Plugin {
  let child: ChildProcess | undefined
  return {
    name: 'atelier-server',
    apply: 'serve',
    configureServer(server) {
      child = spawn(process.execPath, ['--watch', '--env-file-if-exists=server/.env', 'server/index.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PORT: String(API_PORT) },
      })
      server.httpServer?.on('close', () => child?.kill())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), atelierServer()],
  // Même origine pour la page et l'API : le cookie de session fonctionne sans CORS.
  server: { proxy: { '/api': `http://localhost:${API_PORT}` } },
})
