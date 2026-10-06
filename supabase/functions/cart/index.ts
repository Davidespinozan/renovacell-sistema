// Edge Function PÚBLICA (desplegar con --no-verify-jwt): CARRITO CANÓNICO (CC-5).
//
// Misma puerta de identidad que `chat`: visitante por token (CC-1) o cuenta por JWT; el actor lo
// deriva el servidor. El cliente manda acción, cart_id, product_id, cantidad y operation_id.
// NUNCA precio, descuento, lista, profile_id, visitor_id ni seller_profile_id: la autoridad es la
// base (comandos cc_carrito_*, solo service_role). Las acciones directas del usuario NO pasan por
// la IA; las herramientas de CC-4 llaman a los mismos comandos. Sin registro de contenido.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { derivarActor, mapearErrorChat } from '../_shared/chat.ts'
import { validarCantidad, validarOperacion, mapearErrorCarrito } from '../_shared/carrito.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ACCIONES = new Set(['abrir', 'ver', 'agregar', 'actualizar', 'quitar', 'vaciar', 'preparar_checkout', 'revisar_checkout', 'confirmar_checkout'])   // + CC-6 (CC-7: sin "oferta"; el handoff lo dispara el servidor)
const MUTANTES = new Set(['agregar', 'actualizar', 'quitar', 'vaciar'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = typeof p.action === 'string' && ACCIONES.has(p.action) ? p.action as string : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })

  const authHeader = req.headers.get('Authorization') ?? ''
  let quien: { uid: string; role: string } | null = null
  if (authHeader.replace(/^Bearer\s+/i, '').trim() && authHeader.replace(/^Bearer\s+/i, '').trim() !== anon) {
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    quien = { uid: q.quien.uid, role: q.quien.role }
  }
  const hash = quien ? null : await hashToken(p.token)
  const actor = derivarActor(quien, hash)
  if (!actor) return json(401, { error: 'sin_identidad', message: 'Inicia sesión o abre el carrito desde el sitio.' })
  const sujeto = quien ? sujetoUid(quien.uid) : await sujetoPublico(req)
  const falla = (e: { message?: string } | null) => { const m = mapearErrorCarrito(e?.message) ?? mapearErrorChat(e?.message); return json(m.status, m.body) }

  // Límites CC-0B: lectura holgada; mutación acotada por sujeto y techo global.
  const v = await limitarTodas(admin, MUTANTES.has(action)
    ? (quien ? [{ scope: 'cart_mutar_uid', sujeto }, { scope: 'cart_global', sujeto: 'global' }] : [{ scope: 'cart_mutar', sujeto }, { scope: 'cart_global', sujeto: 'global' }])
    : [{ scope: 'cart_leer', sujeto }])
  if (!v.permitido) return respuestaLimite(v)

  const base = { p_actor_type: actor.actor, p_visitor_hash: hash, p_profile: actor.profile }

  // CC-6 · checkout: corre COMO EL DUEÑO AUTENTICADO (cliente con su JWT): la autorización nativa de
  // crear_pedido (doctor verificado) se aplica tal cual. Sin JWT no hay checkout (el visitante se registra).
  if (action === 'revisar_checkout' || action === 'confirmar_checkout') {
    if (!quien) return json(401, { error: 'sin_identidad', message: 'Para confirmar tu pedido inicia sesión o crea tu cuenta.' })
    const vch = await limitarTodas(admin, [{ scope: action === 'confirmar_checkout' ? 'checkout_confirmar_uid' : 'checkout_revisar_uid', sujeto }, { scope: 'checkout_global', sujeto: 'global' }])
    if (!vch.permitido) return respuestaLimite(vch)
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    if (action === 'revisar_checkout') {
      const cartR = typeof p.cart_id === 'string' && UUID.test(p.cart_id) ? p.cart_id : null
      if (!cartR) return json(400, { error: 'falta_carrito', message: 'Falta cart_id.' })
      const loc = typeof p.location_id === 'string' && UUID.test(p.location_id) ? p.location_id : null
      // CC-7 · el Catálogo puede mandar el snapshot de dirección elegido (forma acotada; la base lo valida de nuevo).
      const dir = !loc ? direccionSnapshot(p.direccion) : null
      const { data, error } = await caller.rpc('cc_checkout_revisar', { p_cart: cartR, p_location_id: loc, p_direccion: dir })
      if (error) return falla(error)
      return json(200, data)
    }
    const review = typeof p.review_id === 'string' && UUID.test(p.review_id) ? p.review_id : null
    if (!review) return json(400, { error: 'falta_revision', message: 'Falta review_id.' })
    const opc = validarOperacion(p.operation_id)
    if (!opc) return json(400, { error: 'operacion_invalida', message: 'Falta operation_id válido.' })
    const rev = Number.isInteger(Number(p.expected_cart_rev)) && Number(p.expected_cart_rev) >= 0 ? Number(p.expected_cart_rev) : null
    // Solo review_id + operation_id + rev esperada: NUNCA total, precio, descuento, lista, doctor ni seller.
    const factura = p.factura === true   // solo la intención de factura; los datos fiscales se congelan aparte (set_order_fiscal_snapshot)
    const { data, error } = await caller.rpc('cc_checkout_confirmar', { p_review: review, p_operation: opc, p_expected_rev: rev, p_factura: factura })
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'abrir') {
    if (actor.actor !== 'visitor' && actor.actor !== 'doctor') return json(403, { error: 'no_autorizado', message: 'Solo visitantes y doctores tienen carrito.' })
    const conv = typeof p.conversation_id === 'string' && UUID.test(p.conversation_id) ? p.conversation_id : null
    const { data, error } = await admin.rpc('cc_carrito_abrir', { ...base, p_conv: conv })
    if (error) return falla(error)
    return json(200, data)
  }
  const cart = typeof p.cart_id === 'string' && UUID.test(p.cart_id) ? p.cart_id : null
  if (!cart) return json(400, { error: 'falta_carrito', message: 'Falta cart_id.' })
  if (action === 'ver') {
    const { data, error } = await admin.rpc('cc_carrito_ver', { p_cart: cart, ...base })
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'preparar_checkout') {
    const { data, error } = await admin.rpc('cc_carrito_preparar_checkout', { p_cart: cart, ...base })
    if (error) return falla(error)
    return json(200, data)
  }
  // mutaciones: operation_id obligatorio (idempotencia); cantidad validada aquí Y en la base
  const op = validarOperacion(p.operation_id)
  if (!op) return json(400, { error: 'operacion_invalida', message: 'Falta operation_id válido.' })
  if (action === 'vaciar') {
    const { data, error } = await admin.rpc('cc_carrito_vaciar', { p_cart: cart, ...base, p_op: op })
    if (error) return falla(error)
    return json(200, data)
  }
  const product = typeof p.product_id === 'string' && UUID.test(p.product_id) ? p.product_id : null
  if (!product) return json(400, { error: 'producto_invalido', message: 'Falta product_id.' })
  if (action === 'quitar') {
    const { data, error } = await admin.rpc('cc_carrito_quitar', { p_cart: cart, ...base, p_product: product, p_op: op })
    if (error) return falla(error)
    return json(200, data)
  }
  const qty = validarCantidad(p.cantidad, action === 'actualizar')
  if (qty === null) return json(400, { error: 'cantidad_invalida', message: 'La cantidad no es válida.' })
  const { data, error } = await admin.rpc(action === 'agregar' ? 'cc_carrito_agregar' : 'cc_carrito_actualizar', { p_cart: cart, ...base, p_product: product, p_qty: qty, p_op: op })
  if (error) return falla(error)
  return json(200, data)
}))

// CC-7 · snapshot de dirección del selector del Catálogo: solo campos de texto conocidos y acotados (nunca precio, doctor ni seller).
const CAMPOS_DIRECCION = ['line1', 'colonia', 'cp', 'city', 'state', 'refs', 'phone', 'country', 'contacto'] as const
function direccionSnapshot(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>; const out: Record<string, string> = {}
  for (const k of CAMPOS_DIRECCION) if (typeof o[k] === 'string' && (o[k] as string).trim()) out[k] = (o[k] as string).trim().slice(0, 200)
  return out.line1 ? out : null
}
