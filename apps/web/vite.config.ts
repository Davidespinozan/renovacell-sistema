/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
