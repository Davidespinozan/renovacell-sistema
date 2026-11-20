import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { initSentry } from './lib/sentry'
import { instalarCapturaErrores } from './lib/errores'
import './index.css'

// Arranca la observabilidad (no-op si no hay DSN). Fire-and-forget: no bloquea el render.
void initSentry()
instalarCapturaErrores()   // BLOQUE1 · errores → alertas de Dirección

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
