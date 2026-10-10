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
const doc = as(ids.doc)
const otroPos = as(ids.pos2)
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
// W2: el pedido se libera con un COBRO registrado (ya no se edita payment_status a mano).
r = await admin.rpc('registrar_cobro', { p_op_id: uuid(), p_order: ids.order, p_method: 'transferencia', p_amount: 200 })
expect('W2: registrar_cobro por la API libera el pedido', r.data?.payment_status === 'paid', r.error ?? r.data)
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


// ═══════════════ W2 · verdad de pago por la API real ═══════════════
// 10) Declarar → verificar (parámetros con nombre, opcionales omitidos)
r = await doc.rpc('reportar_pago', { p_op_id: uuid(), p_order: ids.omoney, p_method: 'transferencia', p_amount: 200 })
expect('reportar_pago (doctor, opcionales omitidos) resuelve por nombre', r.data?.status === 'applied', r.error ?? r.data)
const claim = r.data?.claim_id
r = await doc.rpc('reportar_pago', { p_op_id: uuid(), p_order: ids.omoney, p_method: 'transferencia', p_amount: 200 })
expect('una sola declaración abierta por pedido (por la API)', /DECLARACION_ABIERTA/.test(r.error?.message ?? ''), r.error)
r = await doc.rpc('revisar_pago', { p_op_id: uuid(), p_claim_id: claim, p_accion: 'verificar' })
expect('el doctor NO verifica su propio pago', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)
r = await admin.rpc('revisar_pago', { p_op_id: uuid(), p_claim_id: claim, p_accion: 'verificar' })
expect('revisar_pago verifica y genera el asiento', r.data?.resultado === 'verificado' && r.data?.payment_status === 'paid', r.error ?? r.data)

// 11) La vista de dinero se lee por la API y es la definición única
r = await admin.from('v_order_money').select('cobrado_neto, saldo, estado_pago, liberado').eq('order_id', ids.omoney).single()
expect('v_order_money legible por la API', !r.error && Number(r.data.cobrado_neto) === 200 && r.data.estado_pago === 'paid' && r.data.liberado === true, r.error ?? r.data)

// 12) Crédito: se surte sin falsificar el pago (objetivo central)
r = await admin.rpc('autorizar_credito', { p_op_id: uuid(), p_order: ids.ocred, p_due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), p_motivo: 'contrato' })
expect('autorizar_credito por la API libera sin cobro', r.data?.liberado === true && r.data?.payment_status === 'pending', r.error ?? r.data)
r = await admin.from('orders').select('status, payment_status').eq('id', ids.ocred).single()
expect('el crédito NO falsifica status ni payment_status', r.data?.status === 'pending_payment' && r.data?.payment_status === 'pending', r.data)
const { data: it2 } = await wh.from('order_items').select('id, qty').eq('order_id', ids.ocred)
const { data: lot2 } = await wh.from('lots').select('id').eq('lot_code', 'CT-C').single()
r = await wh.rpc('surtir_pedido', { p_op_id: uuid(), p_order: ids.ocred, p_allocations: [{ order_item_id: it2[0].id, lot_id: lot2.id, qty: it2[0].qty }] })
expect('se surte a crédito por la API', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.from('orders').select('status, payment_status').eq('id', ids.ocred).single()
expect('tras surtir a crédito sigue financieramente pendiente', r.data?.status === 'packed' && r.data?.payment_status === 'pending', r.data)

// 13) Autoridad: nadie escribe el dinero por la API
r = await admin.from('orders').update({ payment_status: 'paid' }).eq('id', ids.ocred)
expect('escribir payment_status por la API ⇒ bloqueado (ni Dirección)', /PAGO_SOLO_POR_COMANDO/.test(r.error?.message ?? ''), r.error)
r = await admin.from('payment_entries').insert({ order_id: ids.ocred, direction: 'in', method: 'efectivo', amount: 1, actor_role: 'admin' })
expect('insertar en el libro por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await admin.rpc('pay_order', { p_order: ids.ocred, p_method: 'registrado', p_ref: 'ADM' })
expect('pay_order revocado por la API', r.error?.code === '42501' || r.error?.code === 'PGRST202', r.error)
r = await admin.rpc('review_transfer_payment', { p_order: ids.omoney, p_action: 'confirm' })
expect('firma VIEJA review_transfer_payment ya no existe', r.error?.code === 'PGRST202', r.error)
r = await admin.rpc('registrar_devolucion', { p_order_id: ids.omoney, p_tipo: 'devolucion', p_monto: 1, p_motivo: 'x' })
expect('firma VIEJA registrar_devolucion ya no existe', r.error?.code === 'PGRST202', r.error)

// 14) Superficies de Dirección
r = await admin.rpc('conciliar_dinero')
expect('conciliar_dinero por la API: 0 errores', !r.error && r.data.filter((x) => x.severidad === 'error').length === 0, r.error ?? r.data)
r = await wh.rpc('conciliar_dinero')
expect('almacén no concilia dinero', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)
r = await admin.rpc('estado_dinero_pedido', { p_order: ids.omoney })
expect('estado_dinero_pedido devuelve libro + declaraciones', !r.error && Array.isArray(r.data?.asientos) && r.data.asientos.length === 1, r.error ?? r.data)


// ═══════════════ W2 · superficie que consume el FRONTEND (N5) ═══════════════
// 15) Las columnas que piden los stores, tal cual las manda el cliente: un nombre mal
// escrito aquí es un 400 en producción, no un error de compilación.
const MONEY_COLS = 'order_id, external_ref, order_status, payment_status, total, cobrado, reembolsado, cobrado_neto, saldo, '
  + 'estado_pago, sobrepago, reembolso_pendiente, credito_autorizado, due_date, vencido, liberado'
const CLAIM_COLS = 'id, order_id, method, amount_declared, reference, bank_account_id, proof_path, status, declared_by, '
  + 'declared_at, resolved_at, reject_reason, entry_id'
const ENTRY_COLS = 'id, order_id, claim_id, refund_id, direction, method, amount, value_date, external_ref, bank_account_id, '
  + 'reversal_of, notes, actor_role, created_at'
const CIERRE_COLS = 'id, fecha, alcance, esperado, fondo, contado, diferencia, motivo, usuario, created_at, '
  + 'voids_closing_id, void_reason, cajero, corte_desde, corte_hasta, prev_closing_id'

r = await admin.from('v_order_money').select(MONEY_COLS)
expect('v_order_money: columnas del store (moneyStore)', !r.error && r.data.length > 0, r.error)
r = await admin.from('payment_claims').select(CLAIM_COLS).order('declared_at', { ascending: false })
expect('payment_claims: columnas del store', !r.error && r.data.length > 0, r.error)
r = await admin.from('payment_entries').select(ENTRY_COLS).order('created_at', { ascending: false })
expect('payment_entries: columnas del store', !r.error && r.data.length > 0, r.error)
r = await admin.from('payment_claims').select('id').eq('order_id', ids.omoney).eq('status', 'reportado').maybeSingle()
expect('comprobante abierto por pedido (reviewTransfer) no rompe con 0 filas', !r.error && r.data === null, r.error ?? r.data)

// 16) Reembolso: autorizar ≠ pagar (dos comandos, dos hechos)
r = await admin.rpc('autorizar_reembolso', { p_op_id: uuid(), p_order: ids.omoney, p_tipo: 'devolucion', p_monto: 50, p_motivo: 'producto devuelto', p_usuario: 'Dirección' })
expect('autorizar_reembolso por la API (opcionales omitidos)', r.data?.status === 'applied' && Number(r.data?.restante) === 150, r.error ?? r.data)
const refundId = r.data?.refund_id
r = await admin.from('v_order_money').select('reembolso_pendiente, cobrado_neto').eq('order_id', ids.omoney).single()
expect('autorizado sin pagar ⇒ el dinero NO ha salido', Number(r.data?.reembolso_pendiente) === 50 && Number(r.data?.cobrado_neto) === 200, r.data)
r = await admin.rpc('pagar_reembolso', { p_op_id: uuid(), p_refund_id: refundId, p_method: 'transferencia' })
expect('pagar_reembolso registra el EGRESO', r.data?.status === 'applied' && r.data?.misma_via === true, r.error ?? r.data)
r = await admin.rpc('pagar_reembolso', { p_op_id: uuid(), p_refund_id: refundId, p_method: 'transferencia' })
expect('un reembolso se paga UNA vez (por la API)', /REEMBOLSO_YA_PAGADO/.test(r.error?.message ?? ''), r.error)
r = await admin.from('v_order_money').select('cobrado_neto, saldo, reembolso_pendiente').eq('order_id', ids.omoney).single()
expect('tras pagar: neto 150, saldo 50, nada pendiente', Number(r.data?.cobrado_neto) === 150 && Number(r.data?.saldo) === 50 && Number(r.data?.reembolso_pendiente) === 0, r.data)

// 17) Crédito: revocar por la API (CreditoAcciones)
r = await admin.rpc('revocar_credito', { p_op_id: uuid(), p_order: ids.ocred, p_motivo: 'el cliente no firmó' })
expect('revocar_credito por la API', r.data?.status === 'applied' && r.data?.liberado === false, r.error ?? r.data)
r = await wh.rpc('revocar_credito', { p_op_id: uuid(), p_order: ids.ocred, p_motivo: 'x' })
expect('almacén no revoca crédito', /NO_AUTORIZADO|SIN_CREDITO_VIGENTE/.test(r.error?.message ?? ''), r.error)

// 18) Corte de caja: el ESPERADO y el TRAMO los calcula el servidor (D-W2-CASH-CUTOFF)
const hoy = (await admin.rpc('hoy_local')).data ?? new Date().toISOString().slice(0, 10)
r = await admin.rpc('tramo_corte_caja', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('tramo_corte_caja por la API: primer corte desde el inicio del día', !r.error && r.data?.primer_corte === true && r.data?.continua_de === null, r.error ?? r.data)
r = await admin.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('efectivo_esperado por la API (alcance dia)', !r.error && Number(r.data) > 0, r.error ?? r.data)
const esperado = Number(r.data)
r = await wh.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('el efectivo en caja no se consulta desde Almacén', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)
const opCorte = uuid()
r = await admin.rpc('registrar_corte_caja', { p_op_id: opCorte, p_fecha: hoy, p_alcance: 'dia', p_fondo: 0, p_contado: esperado })
expect('registrar_corte_caja cuadra con el esperado del servidor', r.data?.status === 'applied' && Number(r.data?.diferencia) === 0 && Number(r.data?.esperado) === esperado, r.error ?? r.data)
const closingId = r.data?.closing_id
r = await admin.rpc('registrar_corte_caja', { p_op_id: opCorte, p_fecha: hoy, p_alcance: 'dia', p_fondo: 0, p_contado: esperado })
expect('reintento del MISMO corte ⇒ idempotente', r.data?.status === 'already_applied', r.error ?? r.data)
r = await admin.rpc('registrar_corte_caja', { p_op_id: uuid(), p_fecha: hoy, p_alcance: 'dia', p_fondo: 0, p_contado: esperado + 100 })
expect('una diferencia SIN motivo se rechaza', /MOTIVO_REQUERIDO/.test(r.error?.message ?? ''), r.error)

// El límite económico: el corte siguiente NO vuelve a contar lo ya arqueado
r = await admin.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('tras cortar, el esperado del siguiente corte es 0 (no se recuenta)', Number(r.data) === 0, r.data)
r = await admin.rpc('tramo_corte_caja', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('el tramo siguiente CONTINÚA al corte cerrado', r.data?.primer_corte === false && r.data?.continua_de === closingId, r.error ?? r.data)
// SEC-B (139) · D-SEC-1: el POS cobra SOLO dentro de vender_pos; un cobro directo por la API se rechaza sin asentar
r = await pos.rpc('registrar_cobro', { p_op_id: uuid(), p_order: saleId, p_method: 'efectivo', p_amount: 60 })
expect('POS no registra cobros directos por la API', /NO_AUTORIZADO/.test(r.error?.message ?? '') && !r.data, r.error ?? r.data)
// D-SECB-2: el POS no cierra el corte del día
r = await pos.rpc('registrar_corte_caja', { p_op_id: uuid(), p_fecha: hoy, p_alcance: 'dia', p_fondo: 0, p_contado: 0 })
expect('POS no cierra el corte del día por la API', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error ?? r.data)
// Entra efectivo nuevo (cobro de Dirección con evidencia) ⇒ solo ese entra al tramo siguiente
r = await admin.rpc('registrar_cobro', { p_op_id: uuid(), p_order: saleId, p_method: 'efectivo', p_amount: 60 })
expect('se registra efectivo nuevo después del corte', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('el tramo nuevo arquea SOLO el efectivo posterior', Number(r.data) === 60, r.data)
r = await admin.rpc('registrar_corte_caja', { p_op_id: uuid(), p_fecha: hoy, p_alcance: 'dia', p_fondo: 0, p_contado: 60 })
const closing2 = r.data?.closing_id
expect('el segundo corte del día cuadra sin doble conteo', r.data?.status === 'applied' && Number(r.data?.esperado) === 60 && Number(r.data?.diferencia) === 0, r.error ?? r.data)
r = await admin.from('cash_closings').select(CIERRE_COLS).order('created_at', { ascending: false })
expect('cash_closings: columnas del store (incluye el tramo)', !r.error && r.data.length === 2 && r.data.every((c) => c.corte_desde && c.corte_hasta), r.error ?? r.data)
expect('los tramos se encadenan sin hueco', r.data.some((c) => c.id === closing2 && c.prev_closing_id === closingId), r.data)
r = await admin.from('cash_closings').insert({ fecha: hoy, alcance: 'dia', esperado: 0, fondo: 0, contado: 0, diferencia: 0, usuario: 'x' })
expect('insertar un corte por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await admin.from('cash_closings').delete().eq('id', closingId)
expect('borrar un corte por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await admin.rpc('anular_corte_caja', { p_op_id: uuid(), p_closing_id: closingId, p_motivo: 'mal capturado' })
expect('no se anula un corte intermedio (dejaría huecos entre tramos)', /CORTE_NO_ES_EL_ULTIMO/.test(r.error?.message ?? ''), r.error)
r = await admin.rpc('anular_corte_caja', { p_op_id: uuid(), p_closing_id: closing2, p_motivo: 'mal capturado' })
expect('anular_corte_caja deja contra-registro (no borra)', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.from('cash_closings').select('id, voids_closing_id, void_reason, prev_closing_id')
expect('el corte anulado SIGUE en el historial con su anulación', r.data?.length === 3 && r.data.some((c) => c.voids_closing_id === closing2), r.data)
r = await admin.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
expect('el tramo del corte anulado vuelve a estar por arquear', Number(r.data) === 60, r.data)

// 19) Dinero sobre pedido CANCELADO: se registra (F-9) y se puede reversar
r = await admin.rpc('cancelar_pedido', { p_op_id: uuid(), p_order: ids.order2, p_reason: 'el cliente ya no lo quiere' })
expect('cancelar por comando (no por UPDATE) funciona por la API', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.rpc('registrar_cobro', { p_op_id: uuid(), p_order: ids.order2, p_method: 'efectivo', p_amount: 10 })
expect('un cobro sobre pedido cancelado SE REGISTRA y se avisa', r.data?.status === 'applied' && r.data?.sobre_pedido_cancelado === true, r.error ?? r.data)
const entryMal = r.data?.entry_id
const opRev = uuid()
r = await admin.rpc('reversar_asiento', { p_op_id: opRev, p_entry_id: entryMal, p_motivo: 'cobro aplicado al pedido equivocado' })
expect('reversar_asiento compensa (no edita)', r.data?.status === 'applied', r.error ?? r.data)
r = await admin.rpc('estado_operacion_dinero', { p_op_id: opRev })
expect('estado_operacion_dinero recupera una operación ambigua', r.data?.status === 'already_applied' && r.data?.reversa_de === entryMal, r.error ?? r.data)
r = await admin.from('v_order_money').select('cobrado_neto').eq('order_id', ids.order2).single()
expect('tras la reversa el neto del pedido vuelve a 0', Number(r.data?.cobrado_neto) === 0, r.data)
r = await wh.rpc('estado_operacion_dinero', { p_op_id: opRev })
expect('almacén no lee operaciones de dinero ajenas', !r.error && (r.data === null || r.data === undefined), r.error ?? r.data)

// 20) POS con efectivo recibido (Caja manda p_efectivo_recibido)
const saleCash = uuid()
r = await pos.rpc('vender_pos', { p_order_id: saleCash, p_folio: 'POS-CT2', p_total: 1, p_payment_method: 'efectivo',
  p_doctor_id: null, p_shipping_meta: { channel: 'pos', event_id: null, seller: null }, p_efectivo_recibido: 200,
  p_lines: [{ product_id: ids.prod, qty: 1, unit_price: 150 }],
  p_allocations: [{ line_index: 0, lot_id: lot, qty: 1 }] })
expect('vender_pos acepta p_efectivo_recibido por la API', r.data === true, r.error ?? r.data)
r = await admin.from('payment_entries').select('evidence_ref, method').eq('order_id', saleCash).single()
expect('el efectivo recibido queda como evidencia del asiento', /recibido=200/.test(r.data?.evidence_ref ?? '') && r.data?.method === 'efectivo', r.data)
r = await pos.rpc('vender_pos', { p_order_id: saleCash, p_folio: 'POS-CT2', p_total: 1, p_payment_method: 'efectivo',
  p_doctor_id: null, p_shipping_meta: { channel: 'pos', event_id: null, seller: null }, p_efectivo_recibido: 900,
  p_lines: [{ product_id: ids.prod, qty: 1, unit_price: 150 }],
  p_allocations: [{ line_index: 0, lot_id: lot, qty: 1 }] })
expect('corregir el efectivo recibido NO crea otra venta', r.data === true, r.error ?? r.data)
r = await admin.from('payment_entries').select('id').eq('order_id', saleCash)
expect('la venta POS reintentada sigue con UN solo asiento', r.data?.length === 1, r.data)
r = await pos.rpc('vender_pos', { p_order_id: uuid(), p_folio: 'POS-CT3', p_total: 1, p_payment_method: 'efectivo',
  p_doctor_id: null, p_shipping_meta: { channel: 'pos' }, p_efectivo_recibido: 10,
  p_lines: [{ product_id: ids.prod, qty: 1, unit_price: 150 }],
  p_allocations: [{ line_index: 0, lot_id: lot, qty: 1 }] })
expect('efectivo recibido menor al total ⇒ rechazado', /EFECTIVO_INSUFICIENTE/.test(r.error?.message ?? ''), r.error)


// ═══════════════ W2-C · CUSTODIA por la API real ═══════════════
// 21) El ciclo completo por PostgREST, con los MISMOS nombres de parámetros que manda
// el frontend. Un nombre mal escrito aquí es un 400 en producción.
const CUSTODY_COLS = 'id, kind, holder_kind, holder_user_id, holder_customer_id, event_name, event_venue, '
  + 'event_date, status, opened_at, closed_at, close_reason'
const CUSTODY_LINE_COLS = 'id, custody_id, kind, product_id, lot_id, qty, held_delta, unit_price, order_id, '
  + 'order_item_id, inventory_op_id, motivo, evidence_ref, actor_role, created_at'
const DISP_COLS = 'lot_id, product_id, lot_code, expiry_date, location, propio, en_custodia, disponible, caducado'

// Lote propio para la custodia (por el comando de W1, como siempre)
// Una entrada sin orden la autoriza Dirección (invariante de W1, intacto).
r = await admin.rpc('recibir_lote', { p_op_id: uuid(), p_product: ids.prod, p_lote: 'CT-CUS', p_caducidad: exp, p_cantidad: 10, p_kind: 'sin_orden', p_reason: 'contrato custodia' })
expect('custodia: lote de partida recibido', r.data?.status === 'applied', r.error ?? r.data)
const lotCus = r.data?.lot_id

r = await admin.rpc('abrir_custodia', { p_op_id: uuid(), p_kind: 'vendedor', p_holder_kind: 'staff', p_holder_user_id: ids.pos })
expect('abrir_custodia por la API (opcionales omitidos)', r.data?.status === 'applied', r.error ?? r.data)
const cusId = r.data?.custody_id
r = await pos.rpc('abrir_custodia', { p_op_id: uuid(), p_kind: 'vendedor', p_holder_kind: 'staff', p_holder_user_id: ids.pos })
expect('un vendedor no se abre su propia custodia', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)

r = await wh.rpc('entregar_custodia', { p_op_id: uuid(), p_custody: cusId, p_lines: [{ lot_id: lotCus, qty: 6 }] })
expect('entregar_custodia por la API', r.data?.status === 'applied' && r.data?.unidades === 6, r.error ?? r.data)
r = await wh.from('v_stock_disponible').select(DISP_COLS).eq('lot_id', lotCus).single()
expect('v_stock_disponible: propio 10, en custodia 6, disponible 4', !r.error && r.data.propio === 10 && r.data.en_custodia === 6 && r.data.disponible === 4, r.error ?? r.data)
r = await admin.from('product_stock').select('available').eq('product_id', ids.prod).maybeSingle()
expect('product_stock por la API descuenta la custodia', !r.error && Number(r.data?.available ?? -1) >= 0 && Number(r.data.available) < 10, r.error ?? r.data)

// La entrega no movió inventario ni dinero
r = await wh.from('inventory_movements').select('id').eq('lot_id', lotCus).neq('reason', 'entrada')
expect('la entrega NO generó movimiento de inventario', !r.error && r.data.length === 0, r.error ?? r.data)

// Venta desde custodia: el tenedor, por la MISMA ruta económica
const ventaCus = uuid()
r = await pos.rpc('vender_pos', { p_order_id: ventaCus, p_folio: 'POS-CUS', p_total: 1, p_payment_method: 'efectivo',
  p_doctor_id: null, p_shipping_meta: { channel: 'consigna' },
  p_lines: [{ product_id: ids.prod, qty: 2 }],
  p_allocations: [{ line_index: 0, lot_id: lotCus, qty: 2 }],
  p_custody_id: cusId })
expect('vender_pos con p_custody_id resuelve por nombre y vende', r.data === true, r.error ?? r.data)
r = await admin.from('v_order_money').select('cobrado_neto, payment_status').eq('order_id', ventaCus).single()
expect('la venta de custodia crea la realidad económica de W2', !r.error && Number(r.data.cobrado_neto) > 0 && r.data.payment_status === 'paid', r.error ?? r.data)
r = await admin.from('inventory_movements').select('id, change').eq('order_id', ventaCus).eq('reason', 'venta')
expect('la venta de custodia crea UN movimiento venta', !r.error && r.data.length === 1, r.error ?? r.data)
r = await admin.from('custody_lines').select(CUSTODY_LINE_COLS).eq('order_id', ventaCus)
expect('custody_lines: columnas del store y una línea de venta', !r.error && r.data.length === 1 && r.data[0].kind === 'venta', r.error ?? r.data)
r = await otroPos.rpc('vender_pos', { p_order_id: uuid(), p_folio: 'POS-AJENO', p_total: 1, p_payment_method: 'efectivo',
  p_doctor_id: null, p_shipping_meta: {}, p_lines: [{ product_id: ids.prod, qty: 1 }],
  p_allocations: [{ line_index: 0, lot_id: lotCus, qty: 1 }], p_custody_id: cusId })
expect('otro vendedor no vende de una custodia ajena', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)

// Con saldo en la calle no se cierra
r = await admin.rpc('cerrar_custodia', { p_op_id: uuid(), p_custody: cusId, p_motivo: 'fin del contrato' })
expect('no se cierra con saldo en poder', /CUSTODIA_CON_SALDO/.test(r.error?.message ?? ''), r.error)

// Devolución limpia y pérdida
r = await wh.rpc('devolver_de_custodia', { p_op_id: uuid(), p_custody: cusId, p_lines: [{ lot_id: lotCus, qty: 3, inspection: 'ok' }] })
expect('devolver_de_custodia por la API', r.data?.devuelto_disponible === 3 && r.data?.dado_de_baja === 0, r.error ?? r.data)
r = await wh.rpc('registrar_perdida_custodia', { p_op_id: uuid(), p_custody: cusId, p_kind: 'faltante',
  p_lines: [{ lot_id: lotCus, qty: 1 }], p_motivo: 'conteo físico', p_evidencia: 'acta-ct' })
expect('registrar_perdida_custodia da de baja y NO crea deuda', r.data?.status === 'applied' && /NO genera deuda/.test(r.data?.nota ?? ''), r.error ?? r.data)
r = await pos.rpc('registrar_perdida_custodia', { p_op_id: uuid(), p_custody: cusId, p_kind: 'faltante',
  p_lines: [{ lot_id: lotCus, qty: 1 }], p_motivo: 'yo dije' })
expect('el tenedor no declara sus propias pérdidas', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)

// Estado y cierre
r = await pos.rpc('estado_custodia', { p_custody: cusId })
expect('estado_custodia: el tenedor consulta la suya', !r.error && Array.isArray(r.data?.movimientos), r.error ?? r.data)
r = await wh.rpc('devolver_de_custodia', { p_op_id: uuid(), p_custody: cusId, p_lines: [{ lot_id: lotCus, qty: 0 }] })
expect('cantidad cero rechazada por la API', /CANTIDAD_INVALIDA/.test(r.error?.message ?? ''), r.error)
r = await admin.from('v_custody_stock').select('custody_id, product_id, lot_id, entregado, vendido, devuelto, perdido, en_poder').eq('custody_id', cusId)
expect('v_custody_stock: columnas del store', !r.error && r.data.length === 1 && r.data[0].en_poder === 0, r.error ?? r.data)
r = await admin.rpc('cerrar_custodia', { p_op_id: uuid(), p_custody: cusId, p_motivo: 'fin del contrato' })
expect('cerrar_custodia liquida y cierra', r.data?.status === 'applied' && r.data?.vendidas === 2 && r.data?.devueltas === 3 && r.data?.perdidas === 1, r.error ?? r.data)
r = await admin.from('v_custody_liquidacion').select('custody_id, unidades_entregadas, unidades_vendidas, importe_vendido, cobrado, saldo').eq('custody_id', cusId).single()
expect('v_custody_liquidacion: columnas del store', !r.error && r.data.unidades_entregadas === 6, r.error ?? r.data)
r = await admin.from('custodies').select(CUSTODY_COLS).eq('id', cusId).single()
expect('custodies: columnas del store', !r.error && r.data.status === 'cerrada', r.error ?? r.data)

// 22) Autoridad por la API: la custodia solo se escribe por comando
r = await admin.from('custody_lines').insert({ custody_id: cusId, kind: 'entrega', product_id: ids.prod, lot_id: lotCus, qty: 1, held_delta: 1 })
expect('insertar en el libro de custodia por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await admin.from('custodies').update({ status: 'abierta' }).eq('id', cusId)
expect('reabrir una custodia por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await admin.from('custodies').delete().eq('id', cusId)
expect('borrar una custodia por la API ⇒ 42501', r.error?.code === '42501', r.error)
r = await pos.from('custody_lines').select('id').eq('custody_id', cusId)
expect('el tenedor SÍ lee su propio libro', !r.error && r.data.length > 0, r.error)
r = await doc.from('custodies').select('id')
expect('un doctor no ve custodias', !r.error && r.data.length === 0, r.error)
r = await wh.rpc('custody_held_en', { p_custody: cusId, p_lot: lotCus })
expect('el saldo por custodia no se pide por el helper interno', r.error?.code === '42501' || r.error?.code === 'PGRST202', r.error)

// 23) La custodia LEGACY ya no existe (C4 la dejó inerte, C6 la eliminó). Por la API
// eso se ve como tabla/función inexistente: no queda una segunda autoridad de custodia.
r = await admin.from('events').select('id')
expect('la tabla events legacy ya no existe', r.error?.code === 'PGRST205', r.error)
r = await pos.from('consignment_stock').select('id')
expect('la tabla consignment_stock legacy ya no existe', r.error?.code === 'PGRST205', r.error)
r = await admin.from('events').insert({ name: 'Fantasma' })
expect('no hay evento legacy que insertar', r.error?.code === 'PGRST205', r.error)
r = await admin.rpc('event_sell', { p_event: uuid(), p_sales: [] })
expect('event_sell ya no es una ruta', r.error?.code === 'PGRST202', r.error)

// 24) Conciliación de custodia
r = await admin.rpc('conciliar_custodia')
expect('conciliar_custodia por la API: 0 errores', !r.error && r.data.filter((x) => x.severidad === 'error').length === 0, r.error ?? r.data)
r = await wh.rpc('conciliar_custodia')
expect('almacén no concilia custodia', /NO_AUTORIZADO/.test(r.error?.message ?? ''), r.error)

// 25) SEC-C1 · lecturas por rol con los SELECT EXACTOS de los stores (ordersStore, moneyStore, refundsStore, cierresStore,
//     lotsStore): ninguna falla; para POS, lo visible de tablas hijas ⊆ pedidos visibles; sin reembolsos; solo su corte.
{
  const SEL = {
    orders: 'id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_ref, payment_status, stripe_payment_id, invoice_requested, invoice_meta, shipping_meta, created_at, order_items(id, order_id, product_id, lot_id, qty, unit_price, created_at)',
    v_order_money: 'order_id, external_ref, order_status, payment_status, total, cobrado, reembolsado, cobrado_neto, saldo, estado_pago, sobrepago, reembolso_pendiente, credito_autorizado, due_date, vencido, liberado',
    payment_claims: 'id, order_id, method, amount_declared, reference, bank_account_id, proof_path, status, declared_by, declared_at, resolved_at, reject_reason, entry_id',
    payment_entries: 'id, order_id, claim_id, refund_id, direction, method, amount, value_date, external_ref, bank_account_id, reversal_of, notes, actor_role, created_at',
    refunds: 'id, order_id, tipo, monto, motivo, metodo, usuario, created_at, items',
    cash_closings: 'id, fecha, alcance, esperado, fondo, contado, diferencia, motivo, usuario, created_at, voids_closing_id, void_reason, cajero, corte_desde, corte_hasta, prev_closing_id',
    inventory_movements: 'id, lot_id, change, reason, reference, created_by, created_at, unit_cost',
  }
  const roles = { admin, billing: as(ids.bill), warehouse: wh, packing: as(ids.pk), pos, pos2: otroPos, doctor: doc }
  const leido = {}
  for (const [rol, cli] of Object.entries(roles)) {
    leido[rol] = {}
    for (const [t, cols] of Object.entries(SEL)) {
      const q = await cli.from(t).select(cols)
      leido[rol][t] = q.data ?? []
      if (q.error) bad(`SEC-C1 · ${rol} lee ${t} con el SELECT del store sin error`, q.error)
    }
  }
  ok('SEC-C1 · los 7 SELECT de los stores responden sin error para Dirección, Facturación, Almacén, Empaque, POS y doctor')
  for (const rol of ['pos', 'pos2']) {
    const visibles = new Set(leido[rol].orders.map((o) => o.id))
    const sub = (t) => leido[rol][t].every((x) => x.order_id && visibles.has(x.order_id))
    expect(`SEC-C1 · ${rol}: partidas embebidas, asientos, declaraciones y v_order_money ⊆ pedidos visibles`,
      sub('payment_entries') && sub('payment_claims') && sub('v_order_money') && leido[rol].orders.every((o) => (o.order_items ?? []).every((i) => i.order_id === o.id)),
      { pedidos: visibles.size, asientos: leido[rol].payment_entries.length, declaraciones: leido[rol].payment_claims.length })
    expect(`SEC-C1 · ${rol}: sin reembolsos y solo SUS cortes`, leido[rol].refunds.length === 0
      && leido[rol].cash_closings.every((c) => c.cajero === ids[rol]), { reembolsos: leido[rol].refunds.length, cortes: leido[rol].cash_closings.map((c) => c.cajero) })
  }
  expect('SEC-C1 · el POS ve el efectivo de SU venta de mostrador (asiento de su pedido)', leido.pos.payment_entries.some((e) => e.order_id === saleId), leido.pos.payment_entries.map((e) => e.order_id))
  expect('SEC-C1 · otro POS no ve la venta ni el efectivo del primero', !leido.pos2.orders.some((o) => o.id === saleId) && !leido.pos2.payment_entries.some((e) => e.order_id === saleId),
    leido.pos2.payment_entries.map((e) => e.order_id))
  expect('SEC-C1 · Dirección y Facturación ven todos los asientos, reembolsos y cortes', leido.admin.payment_entries.length > 0
    && leido.billing.payment_entries.length === leido.admin.payment_entries.length && leido.billing.refunds.length === leido.admin.refunds.length
    && leido.billing.cash_closings.length === leido.admin.cash_closings.length, { a: leido.admin.payment_entries.length, b: leido.billing.payment_entries.length })
  expect('SEC-C1 · Almacén y Empaque conservan pedidos con partidas y movimientos (surtido)', leido.warehouse.orders.length === leido.admin.orders.length
    && leido.packing.orders.length === leido.admin.orders.length && leido.warehouse.inventory_movements.length === leido.admin.inventory_movements.length,
    { wh: leido.warehouse.orders.length, adm: leido.admin.orders.length })
  r = await otroPos.rpc('estado_dinero_pedido', { p_order: saleId })
  expect('SEC-C1 · otro POS: estado_dinero_pedido de la venta ajena → NO_AUTORIZADO', r.error?.message === 'NO_AUTORIZADO', r.error ?? r.data)
  r = await pos.rpc('estado_dinero_pedido', { p_order: saleId })
  expect('SEC-C1 · el POS: estado_dinero_pedido de SU venta', !r.error && r.data?.order_id === saleId, r.error ?? r.data)
  r = await pos.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'dia', p_cajero: null })
  expect('SEC-C1 · POS: arqueo del día → NO_AUTORIZADO', /solo puedes consultar tu propio corte/.test(r.error?.message ?? ''), r.error ?? r.data)
  r = await pos.rpc('efectivo_esperado', { p_fecha: hoy, p_alcance: 'cajero', p_cajero: ids.pos })
  expect('SEC-C1 · POS: arqueo de SU corte', !r.error && Number.isFinite(Number(r.data)), r.error ?? r.data)
  r = await pos.rpc('tramo_corte_caja', { p_fecha: hoy, p_alcance: 'cajero', p_cajero: ids.pos2 })
  expect('SEC-C1 · POS: tramo de otro cajero → NO_AUTORIZADO', /solo puedes consultar tu propio corte/.test(r.error?.message ?? ''), r.error ?? r.data)
  r = await pos.rpc('_sec_c1_pos_ve_pedido', { o_id: saleId })
  expect('SEC-C1 · el helper interno no se expone por la API', !!r.error && !r.data, r.error ?? r.data)
}

// 26) SEC-C2 · vistas de custodia con security_invoker: SELECT EXACTOS de custodyStore (v_custody_stock) y liquidacionDe
//     (v_custody_liquidacion, .eq('custody_id').maybeSingle()). Ve la custodia quien la ve en las tablas; nadie más.
{
  const STOCK = 'custody_id, product_id, lot_id, entregado, vendido, devuelto, perdido, en_poder'
  const LIQ = 'custody_id, kind, status, unidades_entregadas, unidades_vendidas, unidades_devueltas, unidades_perdidas, unidades_en_poder, importe_vendido, cobrado, saldo'
  const cols = (o) => Object.keys(o ?? {}).sort().join(',')
  const stockDe = async (cli) => await cli.from('v_custody_stock').select(STOCK).order('custody_id').order('lot_id')
  const liqDe = async (cli) => await cli.from('v_custody_liquidacion').select(LIQ).eq('custody_id', cusId).maybeSingle()
  const refS = await stockDe(admin), refL = await liqDe(admin)
  expect('SEC-C2 · Dirección: existencias de la custodia con las columnas del store', !refS.error && refS.data.some((x) => x.custody_id === cusId)
    && cols(refS.data[0]) === STOCK.split(', ').sort().join(','), refS.error ?? refS.data?.[0])
  expect('SEC-C2 · Dirección: liquidación con las columnas del store y cifras numéricas', !refL.error && refL.data?.custody_id === cusId
    && cols(refL.data) === LIQ.split(', ').sort().join(',') && Number.isFinite(Number(refL.data.importe_vendido)) && Number.isFinite(Number(refL.data.saldo)), refL.error ?? refL.data)
  r = await admin.rpc('estado_custodia', { p_custody: cusId })
  expect('SEC-C2 · la liquidación de Dirección coincide con estado_custodia (cálculo sin cambios)', !r.error
    && Number(r.data?.importe_vendido) === Number(refL.data?.importe_vendido) && Number(r.data?.cobrado) === Number(refL.data?.cobrado)
    && Number(r.data?.unidades_en_poder) === Number(refL.data?.unidades_en_poder), { rpc: r.data?.importe_vendido, vista: refL.data?.importe_vendido })
  for (const [rol, cli] of Object.entries({ Facturación: as(ids.bill), Almacén: wh, Empaque: as(ids.pk) })) {
    const s2 = await stockDe(cli), l2 = await liqDe(cli)
    expect(`SEC-C2 · ${rol}: mismas existencias y liquidación que Dirección`, !s2.error && !l2.error && s2.data.length === refS.data.length
      && Number(l2.data?.importe_vendido) === Number(refL.data?.importe_vendido), s2.error ?? l2.error ?? s2.data?.length)
  }
  let s1 = await stockDe(pos), l1 = await liqDe(pos)
  expect('SEC-C2 · POS titular: SOLO las existencias de su custodia', !s1.error && s1.data.length > 0 && s1.data.every((x) => x.custody_id === cusId), s1.error ?? s1.data)
  expect('SEC-C2 · POS titular: su liquidación (mismo importe vendido que Dirección)', !l1.error && l1.data?.custody_id === cusId
    && Number(l1.data.importe_vendido) === Number(refL.data.importe_vendido), l1.error ?? l1.data)
  for (const [rol, cli] of Object.entries({ 'otro POS': otroPos, doctor: doc, 'sin perfil': as(uuid()) })) {
    s1 = await stockDe(cli); l1 = await liqDe(cli)
    expect(`SEC-C2 · ${rol}: sin existencias de custodia (sin error: la pantalla no se rompe)`, !s1.error && s1.data.length === 0, s1.error ?? s1.data)
    expect(`SEC-C2 · ${rol}: liquidación ajena = null (sin error)`, !l1.error && l1.data === null, l1.error ?? l1.data)
  }
  s1 = await stockDe(as(ids.susp)); l1 = await liqDe(as(ids.susp))
  expect('SEC-C2 · cuenta suspendida: existencias rechazadas', /CUENTA_SUSPENDIDA/.test(s1.error?.message ?? '') && !s1.data, s1.error ?? s1.data)
  expect('SEC-C2 · cuenta suspendida: liquidación rechazada', /CUENTA_SUSPENDIDA/.test(l1.error?.message ?? '') && !l1.data, l1.error ?? l1.data)
  s1 = await stockDe(anon); l1 = await liqDe(anon)
  expect('SEC-C2 · anon: vistas de custodia denegadas', !!s1.error && !!l1.error && !s1.data && !l1.data, s1.data ?? l1.data)
}

process.exit(failed)
