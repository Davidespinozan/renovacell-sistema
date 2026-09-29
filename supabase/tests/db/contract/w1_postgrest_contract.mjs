// W1 · CONTRATO PostgREST real (v14.5, la de producción) con @supabase/postgrest-js (el
// mismo cliente que usa supabase.rpc / supabase.from). Llamadas con los MISMOS nombres y
// formas de parámetros que el frontend W1. Nunca producción: API local sobre el cluster desechable.
import { createHmac } from 'node:crypto'
import { PostgrestClient } from '../../../../node_modules/@supabase/postgrest-js/dist/index.mjs'

const URL = process.env.PGRST_URL, SECRET = process.env.PGRST_JWT_SECRET
const ids = JSON.parse(process.env.W1_CTX)
let failed = 0
const ok = (n) => console.log('PASS: ' + n)
const bad = (n, d) => { failed = 1; console.log('FAIL: ' + n + ' ' + JSON.stringify(d ?? '')) }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub, role = 'authenticated') => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const as = (sub, role) => new PostgrestClient(URL, { headers: sub || role ? { Authorization: `Bearer ${jwt(sub, role)}` } : {} })
const admin = as(ids.admin), wh = as(ids.wh), pos = as(ids.pos), anon = new PostgrestClient(URL, {})
const uuid = () => crypto.randomUUID()
const exp = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10)
const expect = (name, cond, detail) => (cond ? ok(name) : bad(name, detail))

// 1) Recepción contra orden (params opcionales OMITIDOS como en lotsStore)
const op1 = uuid()
let r = await wh.rpc('recibir_lote', { p_op_id: op1, p_product: ids.prod, p_lote: 'CT-1', p_caducidad: exp, p_cantidad: 6, p_replenishment_id: ids.rep, p_kind: 'orden' })
expect('recibir_lote (orden, opcionales omitidos) resuelve por nombre y aplica parcial', !r.error && r.data?.status === 'applied' && r.data?.replenishment_status === 'parcial', r.error ?? r.data)
const lot = r.data?.lot_id
r = await wh.rpc('recibir_lote', { p_op_id: op1, p_product: ids.prod, p_lote: 'CT-1', p_caducidad: exp, p_cantidad: 6, p_replenishment_id: ids.rep, p_kind: 'orden' })
expect('reintento mismo op_id por la API ⇒ already_applied', r.data?.status === 'already_applied', r.error ?? r.data)
r = await admin.rpc('recibir_lote', { p_op_id: uuid(), p_product: ids.prod, p_lote: 'CT-1', p_caducidad: exp, p_cantidad: 2, p_replenishment_id: ids.rep, p_kind: 'excedente', p_reason: 'llegaron de más', p_evidence: 'remisión 1' })
expect('recibir_lote excedente (Dirección) aplica', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.rpc('cerrar_orden_compra', { p_op_id: uuid(), p_replenishment: ids.rep, p_reason: 'proveedor no surtió' })
expect('cerrar_orden_compra aplica', r.data?.status === 'applied', r.error ?? r.data)
r = await wh.rpc('recibir_lote', { p_product: ids.prod, p_lote: 'OLD', p_caducidad: exp, p_cantidad: 1, p_ubicacion: 'X' })
expect('firma VIEJA de recibir_lote ya no existe (frontend viejo falla cerrado)', r.error?.code === 'PGRST202', r.error)
r = await wh.rpc('recibir_lote', { p_op_id: uuid(), p_product: ids.prod, p_lote: 'CT-X', p_caducidad: exp, p_cantidad: 1, p_kind: 'sin_orden', p_reason: 'x' })
expect('error de negocio llega con código P0001 y mensaje CODIGO: (no ambiguo)', r.error?.code === 'P0001' && /^NO_AUTORIZADO:/.test(r.error.message), r.error)

// 2) Surtido con asignaciones por renglón
r = await admin.from('orders').update({ status: 'paid', payment_status: 'paid' }).eq('id', ids.order).select('status')
expect('admin: pending_payment → paid sigue permitido por la guarda', !r.error && r.data?.[0]?.status === 'paid', r.error)
const { data: items } = await wh.from('order_items').select('id, qty').eq('order_id', ids.order)
r = await wh.rpc('surtir_pedido', { p_op_id: uuid(), p_order: ids.order, p_allocations: [{ order_item_id: items[0].id, lot_id: lot, qty: items[0].qty }] })
expect('surtir_pedido (jsonb de asignaciones por renglón) aplica', r.data?.status === 'applied', r.error ?? r.data)
r = await wh.from('inventory_movements').select('id, order_id, order_item_id, op_id').eq('order_id', ids.order)
expect('kardex filtrable por order_id desde la API (returnableForOrder)', !r.error && r.data.length === 1 && r.data[0].order_item_id === items[0].id, r.error ?? r.data)

// 3) Cancelación de empacado + reingreso (embed de renglones como stockReturnsStore)
r = await admin.rpc('cancelar_pedido', { p_op_id: uuid(), p_order: ids.order, p_reason: 'Cliente desistió' })
expect('cancelar_pedido aplica con reingreso pendiente', r.data?.status === 'applied' && r.data?.reingreso_pendiente === true, r.error ?? r.data)
r = await wh.from('stock_returns').select('id, order_id, origin, notes, created_at, lines:stock_return_lines(id, return_id, order_id, order_item_id, product_id, lot_id, qty, inspection, notes, disposition, created_at)').order('created_at', { ascending: false })
const ret = r.data?.find((x) => x.order_id === ids.order)
expect('embed stock_returns → lines:stock_return_lines resuelve (relación FK)', !r.error && ret?.lines?.length === 1, r.error ?? r.data)
r = await wh.rpc('confirmar_reingreso', { p_op_id: uuid(), p_return_id: ret.id, p_lines: ret.lines.map((l) => ({ line_id: l.id, estado: 'ok' })) })
expect('confirmar_reingreso aplica', r.data?.status === 'applied' && r.data?.reingresados === 1, r.error ?? r.data)
r = await wh.from('orders').update({ status: 'cancelled' }).eq('id', ids.order2)
expect('cancelación DIRECTA por la API bloqueada (frontend viejo)', /TRANSICION_SOLO_POR_COMANDO/.test(r.error?.message ?? ''), r.error)

// 4) POS: p_doctor_id NULL, opcionales omitidos, line_index, shipping_meta objeto; reintento ⇒ true
const saleId = uuid()
const sale = { p_order_id: saleId, p_folio: 'POS-CT1', p_total: 1, p_payment_method: 'efectivo', p_doctor_id: null,
  p_shipping_meta: { channel: 'pos', event_id: null, seller: null }, p_lines: [{ product_id: ids.prod, qty: 2, unit_price: 1 }],
  p_allocations: [{ line_index: 0, lot_id: lot, qty: 2 }], p_invoice_requested: false }
r = await pos.rpc('vender_pos', sale)
expect('vender_pos (doctor NULL, opcionales omitidos) ⇒ true', r.data === true, r.error ?? r.data)
r = await pos.rpc('vender_pos', sale)
expect('vender_pos reintento idéntico ⇒ true (sin duplicar)', r.data === true, r.error ?? r.data)
r = await admin.from('orders').select('id').eq('id', saleId)
expect('una sola venta registrada', r.data?.length === 1, r.data)

// 5) Devolución en dos pasos (p_notes omitido)
r = await wh.rpc('recibir_devolucion', { p_op_id: uuid(), p_order: saleId, p_lines: [{ lot_id: lot, qty: 1, inspection: 'ok' }] })
expect('recibir_devolucion aplica', r.data?.status === 'applied', r.error ?? r.data)
const retId = r.data?.return_id
r = await wh.from('stock_return_lines').select('id').eq('return_id', retId)
r = await admin.rpc('disponer_devolucion', { p_op_id: uuid(), p_lines: r.data.map((l) => ({ line_id: l.id, disposition: 'vendible' })) })
expect('disponer_devolucion aplica', r.data?.status === 'applied' && r.data?.vendible === 1, r.error ?? r.data)

// 6) Merma (D-06) + ajuste positivo bloqueado para almacén + estado de operación
const opM = uuid()
r = await wh.rpc('ajustar_lote', { p_op_id: opM, p_lot: lot, p_delta: -1, p_kind: 'merma', p_reason: 'frasco roto' })
expect('ajustar_lote merma (p_receipt_id omitido) aplica', r.data?.status === 'applied', r.error ?? r.data)
r = await wh.rpc('ajustar_lote', { p_op_id: uuid(), p_lot: lot, p_delta: 3, p_kind: 'ajuste', p_reason: 'sobran' })
expect('ajuste positivo de almacén rechazado por el servidor', /^NO_AUTORIZADO:/.test(r.error?.message ?? ''), r.error)
r = await wh.rpc('inv_estado_operacion', { p_op_id: opM })
expect('inv_estado_operacion devuelve el resultado al actor (recuperación ambigua)', r.data?.status === 'already_applied', r.error ?? r.data)

// 7) Guía: anulación manual (evidencia omitida)
r = await admin.rpc('anular_guia_manual', { p_op_id: uuid(), p_attempt_id: ids.attempt, p_reference: 'PORTAL-CT' })
expect('anular_guia_manual aplica', r.data?.status === 'applied', r.error ?? r.data)

// 8) Superficies de Dirección
r = await admin.rpc('conciliar_inventario')
expect('conciliar_inventario por la API: 0 errores', !r.error && r.data.filter((x) => x.severidad === 'error').length === 0, r.error ?? r.data)
r = await admin.rpc('auditoria_bajas')
expect('auditoria_bajas por la API lista la merma', !r.error && r.data.some((x) => x.motivo === 'frasco roto'), r.error ?? r.data)
r = await wh.rpc('conciliar_inventario')
expect('almacén no concilia', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)

// 9) Negativos de autoridad por la API
r = await wh.from('lots').update({ quantity: 999 }).eq('id', lot)
expect('escritura directa a lots por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await wh.rpc('apply_lot_movement', { p_lot: lot, p_change: 5, p_reason: 'ajuste', p_reference: 'x' })
expect('apply_lot_movement revocado por la API', r.error?.code === '42501' || r.error?.code === 'PGRST202', r.error)
r = await anon.rpc('recibir_lote', { p_op_id: uuid(), p_product: ids.prod, p_lote: 'A', p_caducidad: exp, p_cantidad: 1 })
expect('anon no ejecuta comandos W1', !!r.error && r.error.code !== 'P0001', r.error)
r = await wh.rpc('_w1_trusted', { p_on: true })
expect('helper interno _w1_trusted no expuesto', !!r.error, r.error)

process.exit(failed)
