// CALIDAD VISUAL (7 nov 2026) · barras de pestañas y chips que se desbordan en celular: la pestaña ACTIVA siempre a la vista
// (antes quedaba fuera de pantalla y no se sabía en qué sección estabas) y un desvanecido en la orilla cuando hay más
// opciones a un lado. Un solo ayudante para todas las barras `.seg` / `.chips-scroll` del sistema (no pantalla por pantalla).
export const SELECTOR_BARRAS = '.seg, .chips-scroll, .fchips'

/** Marca la barra: data-mas="der" | "izq" | "ambos" según haya contenido escondido a cada lado. */
export function marcarBarra(el: HTMLElement): void {
  const max = el.scrollWidth - el.clientWidth
  if (max <= 2) { el.removeAttribute('data-mas'); return }
  const izq = el.scrollLeft > 2; const der = el.scrollLeft < max - 2
  el.setAttribute('data-mas', izq && der ? 'ambos' : der ? 'der' : izq ? 'izq' : '')
}

/** Lleva la opción activa a la vista sin mover la página (solo el scroll horizontal de la barra). */
export function mostrarActiva(el: HTMLElement): void {
  const act = el.querySelector<HTMLElement>('.active, [aria-selected="true"], .on')
  if (!act || el.scrollWidth <= el.clientWidth) return
  const centro = act.offsetLeft - (el.clientWidth - act.offsetWidth) / 2
  el.scrollLeft = Math.max(0, Math.min(centro, el.scrollWidth - el.clientWidth))
}

const vistas = new WeakSet<HTMLElement>()
/** Revisa todas las barras dentro de `raiz`; la primera vez les engancha el scroll. */
export function revisarBarras(raiz: ParentNode = document): void {
  for (const el of Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_BARRAS))) {
    if (!vistas.has(el)) { vistas.add(el); el.addEventListener('scroll', () => marcarBarra(el), { passive: true }); el.addEventListener('click', () => requestAnimationFrame(() => { mostrarActiva(el); marcarBarra(el) })) }
    mostrarActiva(el); marcarBarra(el)
  }
}

/** Observa el contenido (cambios de pantalla, pestañas que cargan después) y el tamaño de la ventana. Devuelve cómo apagarlo. */
export function observarBarras(raiz: HTMLElement): () => void {
  let pendiente = 0
  const correr = () => { if (pendiente) return; pendiente = requestAnimationFrame(() => { pendiente = 0; revisarBarras(raiz) }) }
  const mo = new MutationObserver(correr); mo.observe(raiz, { childList: true, subtree: true })
  window.addEventListener('resize', correr)
  correr()
  return () => { mo.disconnect(); window.removeEventListener('resize', correr); if (pendiente) cancelAnimationFrame(pendiente) }
}
