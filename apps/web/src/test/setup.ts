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
