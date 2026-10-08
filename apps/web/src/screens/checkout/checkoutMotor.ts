// MC-1 · Checkout CANÓNICO compartido (hoy lo abre Catálogo; MC-2 lo abrirá también desde el Chat). Un solo
// motor: Edge `cart` → cc_checkout_revisar → cc_checkout_confirmar → crear_pedido (W1). Aquí no hay reglas
// económicas: los importes que se muestran son los de la REVISIÓN del servidor (precio por volumen, huella de
// precio, disponibilidad, dirección, cliente vinculado) y el servidor vuelve a validar todo al confirmar.
//
// Idempotencia: una clave por INTENTO LÓGICO = (revisión, factura, perfil fiscal). El doble clic comparte la
// misma promesa; un reintento tras un fallo de red reusa la clave (el ledger cc_checkout_operations devuelve el
// mismo resultado); una revisión nueva —o cambiar la factura— usa una clave nueva. Nunca se reutiliza una
// clave para una operación distinta.
import { useCallback, useEffect, useRef, useState } from 'react'
import { carrito as clientePorDefecto, nuevaOperacion, ETIQUETA_MOTIVO, textoProblemas, type ClienteCarrito, type RevisionCheckout } from '../../data/ops/carrito'
import type { ShippingAddress } from '../../data/ops/shippingAddress'

export interface EleccionEntrega { address: ShippingAddress | null; locationId?: string }
export interface PedidoMin { id: string; external_ref: string | null; total: number | null }
export type ResultadoPedido = { ok: true; order: PedidoMin; aviso?: string } | { ok: false; error: string }
export interface LineaVista { product_id: string; nombre: string; qty: number; unitario: number | null; subtotal: number | null; por_volumen?: boolean }

/** Lo que el checkout necesita del dueño del carrito canónico (Catálogo hoy; Chat en MC-2). */
export interface ConfigServidor {
  cliente?: ClienteCarrito
  /** Espera las mutaciones en curso y devuelve el carrito a revisar. */
  obtenerCartId: () => Promise<string | null>
  nombreDe?: (productId: string) => string
  /** El carrito se convirtió en pedido: recargar carrito/pedidos de quien monta. */
  onPedido?: () => void
}

const MARGEN_VENCIMIENTO_MS = 30_000

/** Identidad de la dirección revisada: una revisión solo sirve para la MISMA dirección. */
export function claveEntrega(e: EleccionEntrega | null): string {
  if (!e?.address && !e?.locationId) return 'ninguna'
  return e.locationId ? `loc:${e.locationId}` : `dir:${JSON.stringify(e.address)}`
}

/** Argumentos de revisión: ubicación guardada por id; dirección nueva o de legado como snapshot. */
export function argsRevision(e: EleccionEntrega | null): [string | null, ShippingAddress | null] {
  return [e?.locationId ?? null, e?.locationId ? null : e?.address ?? null]
}

/** Líneas e importe a mostrar: SIEMPRE los de la revisión del servidor (nunca precios de lista locales). */
const monto = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)   // solo importes numéricos del servidor

export function vistaDe(r: RevisionCheckout | null): { lineas: LineaVista[]; total: number | null } {
  if (!r) return { lineas: [], total: null }
  if (r.lineas?.length) return { lineas: r.lineas.map((l) => ({ product_id: l.product_id, nombre: l.nombre, qty: l.qty, unitario: monto(l.precio_unitario), subtotal: monto(l.subtotal) })), total: monto(r.total) }
  const items = r.proyeccion?.items ?? []
  return {
    lineas: items.map((i) => ({ product_id: i.product_id, nombre: i.nombre, qty: i.cantidad, unitario: monto(i.precio?.unitario), subtotal: monto(i.precio?.subtotal), por_volumen: i.precio?.por_volumen })),
    total: monto(r.total),
  }
}

/** Problemas de la revisión en lenguaje del checkout. La dirección se resuelve AQUÍ (no en Perfil). */
export function textoProblemasCheckout(problemas: RevisionCheckout['problemas'], nombre?: (id: string) => string, conDireccion = true): string {
  return (problemas ?? [])
    .filter((p) => conDireccion || p !== 'REQUIERE_DIRECCION')
    .map((p) => (p === 'REQUIERE_DIRECCION' ? 'revisa la dirección de entrega (calle y número, código postal de 5 dígitos)' : textoProblemas([p], nombre)))
    .join(' · ')
}

const vigente = (r: RevisionCheckout | null, clave: string, claveRev: string | null) =>
  !!r?.listo && !!r.review_id && r.cart_rev != null && claveRev === clave && (!r.expires_at || Date.parse(r.expires_at) - Date.now() > MARGEN_VENCIMIENTO_MS)

/**
 * Estado del checkout canónico. `cfg` null = sin servidor (modo demo): el hook queda inerte.
 * `cfg` se lee por referencia (quien monta puede recrearlo en cada render).
 */
export function useCheckoutCanonico(cfg: ConfigServidor | null) {
  const cfgRef = useRef(cfg); cfgRef.current = cfg
  const [revision, setRevision] = useState<RevisionCheckout | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [errorRevision, setErrorRevision] = useState<string | null>(null)
  const revRef = useRef<{ r: RevisionCheckout | null; clave: string | null }>({ r: null, clave: null })
  const claves = useRef(new Map<string, string>())
  const enCurso = useRef<Promise<ResultadoPedido> | null>(null)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  const revisar = useCallback(async (e: EleccionEntrega | null): Promise<RevisionCheckout | { error: string }> => {
    const c = cfgRef.current
    if (!c) return { error: 'El checkout requiere conexión con el servidor.' }
    const cliente = c.cliente ?? clientePorDefecto
    setRevisando(true)
    try {
      const cartId = await c.obtenerCartId()
      if (!cartId) { const error = 'Tu carrito no está disponible. Recarga la página.'; if (vivo.current) setErrorRevision(error); return { error } }
      const r = await cliente.revisarCheckout(cartId, ...argsRevision(e))
      if (!r.ok) { if (vivo.current) setErrorRevision(r.error.mensaje); return { error: r.error.mensaje } }
      revRef.current = { r: r.data, clave: claveEntrega(e) }
      if (vivo.current) { setRevision(r.data); setErrorRevision(null) }
      return r.data
    } finally { if (vivo.current) setRevisando(false) }
  }, [])

  // Al abrir: importes del servidor (sin dirección elegida aún el servidor usa la predeterminada, si existe).
  useEffect(() => { if (cfgRef.current) void revisar(null) }, [revisar])

  const confirmarUnaVez = async (e: EleccionEntrega, factura: boolean, perfilFiscalId: string | null): Promise<ResultadoPedido> => {
    const c = cfgRef.current
    if (!c) return { ok: false, error: 'El checkout requiere conexión con el servidor.' }
    const cliente = c.cliente ?? clientePorDefecto
    const clave = claveEntrega(e)
    let rv = revRef.current.r
    if (!vigente(rv, clave, revRef.current.clave)) {
      const nueva = await revisar(e)
      if ('error' in nueva) return { ok: false, error: nueva.error }
      rv = nueva
    }
    if (!rv) return { ok: false, error: 'No se pudo revisar tu pedido. Intenta de nuevo.' }
    if (!rv.listo || !rv.review_id || rv.cart_rev == null) {
      if (rv.order_id) { c.onPedido?.(); return { ok: true, order: { id: rv.order_id, external_ref: null, total: null } } }   // ya se había convertido (reintento)
      return { ok: false, error: `Antes de pedir: ${textoProblemasCheckout(rv.problemas, c.nombreDe)}.` }
    }
    const intento = `${rv.review_id}|${factura ? perfilFiscalId ?? 'sin-perfil' : 'sin-factura'}`
    let op = claves.current.get(intento)
    if (!op) { op = nuevaOperacion(); claves.current.set(intento, op) }
    const cf = await cliente.confirmarCheckout(rv.review_id, rv.cart_rev, op, factura, factura ? perfilFiscalId : null)
    if (!cf.ok) return { ok: false, error: cf.error.mensaje }   // misma revisión y misma clave en el reintento
    if (cf.data.confirmado && cf.data.order_id) {
      c.onPedido?.()
      return { ok: true, order: { id: cf.data.order_id, external_ref: cf.data.folio ?? null, total: cf.data.total ?? null } }
    }
    // Rechazo con motivo (carrito/precio cambió, revisión vencida o consumida): se descarta la revisión y se
    // vuelve a revisar para mostrar los importes vigentes. El siguiente intento lleva clave nueva.
    const motivo = ETIQUETA_MOTIVO[cf.data.motivo ?? ''] ?? 'No se pudo confirmar.'
    revRef.current = { r: null, clave: null }
    const fresca = await revisar(e)
    if (!('error' in fresca) && fresca.order_id) { c.onPedido?.(); return { ok: true, order: { id: fresca.order_id, external_ref: null, total: null } } }
    return { ok: false, error: `${motivo} Revisa los importes actualizados y confirma de nuevo.` }
  }

  /** Confirma: el doble clic comparte el mismo intento en vuelo (un solo pedido). */
  const confirmar = useCallback((e: EleccionEntrega, factura: boolean, perfilFiscalId: string | null): Promise<ResultadoPedido> => {
    if (enCurso.current) return enCurso.current
    const p = confirmarUnaVez(e, factura, perfilFiscalId).finally(() => { enCurso.current = null })
    enCurso.current = p
    return p
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  return { revision, revisando, errorRevision, revisar, confirmar, vista: vistaDe(revision) }
}
