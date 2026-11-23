// REFRESCO SUAVE (23 nov 2026, dueño: «a los vendedores no les sale que ya está entregado»). Los pedidos y los envíos se
// cargaban UNA vez al entrar: si el chofer marcaba «Entregado», la vendedora seguía viendo «En camino» hasta recargar.
// Ahora se vuelven a leer en silencio cada `cadaMs` mientras la pestaña está a la vista y al regresar a ella (si pasó
// más de 30 s). Sin pestaña visible no consulta nada.
export function refrescoSuave(recargar: () => unknown, cadaMs = 120_000): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
  let ultimo = Date.now()
  const correr = () => { ultimo = Date.now(); try { void recargar() } catch { /* el siguiente intento lo repite */ } }
  const alVolver = () => { if (document.visibilityState === 'visible' && Date.now() - ultimo > 30_000) correr() }
  const t = window.setInterval(() => { if (document.visibilityState === 'visible') correr() }, cadaMs)
  document.addEventListener('visibilitychange', alVolver)
  window.addEventListener('focus', alVolver)
  return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('focus', alVolver) }
}
