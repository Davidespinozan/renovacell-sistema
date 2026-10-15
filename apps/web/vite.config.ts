/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import type { Plugin } from 'vite'

// VERSIÓN PUBLICADA · cada compilación sabe de qué commit sale (Netlify da COMMIT_REF; en local, git). La app la lleva
// dentro (__VERSION__) y el sitio publica /version.json: así se comprueba qué está en el aire y la app abierta detecta
// que hay una versión nueva.
function commitActual(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'desconocida' }
}
const VERSION = commitActual()
function versionPublicada(): Plugin {
  return {
    name: 'renovacell-version', apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit: VERSION, compilado: new Date().toISOString() }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionPublicada()],
  define: { __VERSION__: JSON.stringify(VERSION) },
  server: { port: 5173 },
  // Pruebas: entorno node por defecto (lógica pura); los tests de componentes
  // fijan jsdom con `// @vitest-environment jsdom`. jest-dom carga en el setup.
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Fuerza modo MOCK en las pruebas (hasSupabase=false): datos deterministas y
    // sin red, aunque exista .env.local. Los tests de backend/RLS van aparte (node).
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
  build: {
    chunkSizeWarningLimit: 700, // recharts es un chunk lazy grande, esperado
    rollupOptions: {
      // Dos páginas, una aplicación: el sistema y el enlace de contacto (su propio título y vista previa al compartir).
      input: { main: 'index.html', contacto: 'contacto.html', invitacion: 'invitacion.html' },
      output: {
        // Separa librerías pesadas en chunks propios (mejor cacheo y carga).
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
