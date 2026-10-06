// CC-7 · Carrito CANÓNICO del doctor para las superficies del portal (Catálogo, Asistente). Es el
// mismo carrito del servidor que ve el Chat: no hay un segundo carrito en el navegador. Cada cambio
// es un comando idempotente (operation_id) y pasa por la mutación canónica, que es la que dispara
// el handoff comercial al primer artículo. Las mutaciones se SERIALIZAN (doble clic, ráfagas) y la
// vista es optimista solo mientras el servidor confirma; la verdad final es la proyección del servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { carrito as clientePorDefecto, type Carrito, type ClienteCarrito } from '../ops/carrito'

type Paso = { ok: boolean; error?: { mensaje: string } }

export function useCarritoCanonico(activo: boolean, cliente: ClienteCarrito = clientePorDefecto) {
  const [cart, setCart] = useState<Carrito | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [optimista, setOptimista] = useState<Record<string, number>>({})
  const cola = useRef<Promise<void>>(Promise.resolve())
  const cartRef = useRef<Carrito | null>(null)

  const recargar = useCallback(async () => {
    const r = await cliente.abrir(null)
    if (!r.ok) { setError(r.error.mensaje); return }
    cartRef.current = r.data; setCart(r.data); setError(null)
  }, [cliente])

  useEffect(() => { if (activo) void recargar() }, [activo, recargar])

  const servidor = useMemo(() => Object.fromEntries((cart?.items ?? []).map((i) => [i.product_id, i.cantidad])) as Record<string, number>, [cart])
  const qty = useMemo(() => {
    const out: Record<string, number> = { ...servidor }
    for (const [k, v] of Object.entries(optimista)) { if (v <= 0) delete out[k]; else out[k] = v }
    return out
  }, [servidor, optimista])

  const encolar = useCallback((fn: (cartId: string, actual: Record<string, number>) => Promise<Paso>, despues?: () => void) => {
    cola.current = cola.current.then(async () => {
      if (!cartRef.current) await recargar()
      const c = cartRef.current
      if (!c) return
      const actual = Object.fromEntries(c.items.map((i) => [i.product_id, i.cantidad])) as Record<string, number>
      const r = await fn(c.cart_id, actual)
      if (!r.ok && r.error) setError(r.error.mensaje)
      await recargar()
      despues?.()
    }).catch(() => { setError('No hay conexión con el servidor. Intenta de nuevo.') })
    return cola.current
  }, [recargar])

  /** Fija la cantidad de un producto (0 = quitarlo). La decisión agregar/actualizar usa el estado del SERVIDOR al ejecutar. */
  const fijar = useCallback((productId: string, n: number) => {
    setOptimista((o) => ({ ...o, [productId]: n }))
    return encolar((id, actual) => (n <= 0 ? cliente.quitar(id, productId) : actual[productId] ? cliente.actualizar(id, productId, n) : cliente.agregar(id, productId, n)),
      () => setOptimista((o) => { const { [productId]: _x, ...rest } = o; return rest }))
  }, [cliente, encolar])

  const vaciar = useCallback(() => {
    setOptimista(Object.fromEntries(Object.keys(qty).map((k) => [k, 0])))
    return encolar((id) => cliente.vaciar(id), () => setOptimista({}))
  }, [cliente, encolar, qty])

  /** Espera a que terminen las mutaciones en curso (antes de revisar el checkout). */
  const esperar = useCallback(() => cola.current, [])

  return { cart, qty, error, fijar, vaciar, recargar, esperar, listo: !!cart }
}
