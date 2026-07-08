// @supabase/supabase-js v2 exige un `WebSocket` global al CREAR el cliente, y
// lib/supabase.ts lo crea al importar. Node sin WebSocket nativo (p. ej. el Node 20
// del CI) lanzaría al importar cualquier store. En tests operamos en modo mock (nunca
// se abre realtime), así que un stub basta para no romper la importación. Va ANTES de
// jest-dom para estar listo cuando el grafo de módulos del test cargue lib/supabase.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class { close() {} } as unknown as typeof WebSocket
}

// Setup de pruebas: matchers de jest-dom (toBeInTheDocument, toHaveTextContent…)
// para los tests de componentes. Se carga en todos los archivos (inofensivo en
// los de lógica pura).
import '@testing-library/jest-dom/vitest'

// jsdom no implementa scrollIntoView (lo usan hilos/listas con auto-scroll).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Shims para pantallas con gráficas (recharts) y responsivos: jsdom no trae
// ResizeObserver ni matchMedia.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
