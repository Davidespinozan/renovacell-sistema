// Edge Function: el cliente REPORTA que ya pagó un pedido (transferencia/depósito).
//
// W2 · reportar ≠ cobrar. Esta función NO mueve dinero y NO marca el pedido pagado:
// crea una DECLARACIÓN en `payment_claims` con el comando `reportar_pago`, que queda
// en la cola "Pagos por validar". El cobro nace después, cuando Facturación verifica
// el comprobante (`revisar_pago`) — ahí se escribe el asiento en el libro.
//
// Por qué sigue siendo una Edge Function y no una llamada directa del navegador:
//   1) el COMPROBANTE se sube al bucket privado `proofs` con service role (el doctor
//      no tiene permiso de escritura ahí),
//   2) el AVISO a Dirección se inserta con service role (el RLS impide que un doctor
//      inserte notificaciones), así que si no, nadie se enteraría.
// El comando en sí se ejecuta CON EL JWT DEL LLAMANTE: la autoría de la declaración
// (declared_by) y la validación de dueño son las del cliente real, no del service role.
// Requiere JWT (cliente autenticado). Desplegar SIN --no-verify-jwt.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Decodifica un data-URI de imagen a bytes (para subir el comprobante).
function decodeDataUrl(dataUrl?: string): { bytes: Uint8Array; contentType: string } | null {
  if (!dataUrl) return null
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, contentType: m[1] }
}

// Mensajes de operador para los códigos del comando (el resto se pasa tal cual).
const MENSAJES: Record<string, string> = {
  DECLARACION_ABIERTA: 'Ya tienes un pago de este pedido en revisión. Te avisamos en cuanto lo confirmemos.',
  SIN_SALDO: 'Ese pedido no tiene saldo por cobrar.',
  PEDIDO_CANCELADO: 'Ese pedido está cancelado.',
  NO_AUTORIZADO: 'Ese pedido no es tuyo.',
  MONTO_INVALIDO: 'El monto debe ser mayor a cero.',
  METODO_INVALIDO: 'Forma de pago no válida.',
  CUENTA_INVALIDA: 'La cuenta bancaria seleccionada no es válida o está inactiva.',
  OP_ID_REUTILIZADO: 'Ese reporte ya se registró con otros datos. Recarga la pantalla antes de reintentar.',
}
const traducir = (msg: string): string => {
  const code = /\b([A-Z][A-Z0-9_]{3,})(?=:)/.exec(msg)?.[1]
  return (code && MENSAJES[code]) || msg.replace(/^[A-Z_]+:\s*/, '') || 'No se pudo registrar tu reporte.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const q = await resolverQuien(caller, createClient(url, service, { auth: { persistSession: false } }))
  if (!q.ok) return json(q.status, q.body)
  const who = { user: { id: q.quien.uid, email: q.quien.email ?? undefined } }

  let body: {
    orderId?: string; reference?: string; proof?: string
    bank_account_id?: string | null; amount?: number; method?: string; opId?: string
  }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!body.orderId || !UUID.test(body.orderId)) return json(400, { error: 'Falta el pedido.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // El pedido se lee solo para nombrarlo en el aviso y para tomar el saldo por omisión.
  // La autoridad sobre dueño/estado/saldo es del comando, no de esta función.
  const { data: order } = await admin.from('orders').select('id, external_ref, doctor_id').eq('id', body.orderId).single()
  if (!order) return json(404, { error: 'Pedido no encontrado.' })
  const { data: dinero } = await admin.from('v_order_money').select('saldo').eq('order_id', body.orderId).maybeSingle()

  const monto = typeof body.amount === 'number' && body.amount > 0 ? body.amount : Number(dinero?.saldo ?? 0)
  if (!(monto > 0)) return json(400, { error: 'Ese pedido no tiene saldo por cobrar.' })
  const metodo = ['transferencia', 'efectivo', 'tarjeta', 'stripe', 'otro'].includes(body.method ?? '')
    ? body.method! : 'transferencia'

  // Comprobante (opcional) → bucket privado. Se sube ANTES del comando para poder
  // guardar su ruta en la declaración; si el comando falla, el archivo queda huérfano
  // (sin efecto contable) y el siguiente intento sube el suyo.
  let proofPath: string | null = null
  const dec = decodeDataUrl(body.proof)
  if (dec) {
    const path = `transfers/${order.id}/${Date.now()}.jpg`
    const up = await admin.storage.from('proofs').upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
    if (!up.error) proofPath = path
  }

  // El op_id lo manda el cliente para que un reintento del MISMO reporte no cree dos
  // declaraciones; si no llega, se genera aquí.
  const opId = body.opId && UUID.test(body.opId) ? body.opId : crypto.randomUUID()

  // COMANDO con el JWT del llamante: reportar_pago valida dueño, saldo, método y cuenta.
  const { data: res, error } = await caller.rpc('reportar_pago', {
    p_op_id: opId,
    p_order: body.orderId,
    p_method: metodo,
    p_amount: monto,
    p_reference: (body.reference ?? '').slice(0, 80) || undefined,
    p_bank_account_id: typeof body.bank_account_id === 'string' && UUID.test(body.bank_account_id) ? body.bank_account_id : undefined,
    p_proof_path: proofPath ?? undefined,
  })
  if (error) return json(400, { error: traducir(error.message) })

  const estado = (res as { status?: string } | null)?.status
  // Avisa a Dirección (service role: sin el bloqueo del doctor). Solo en la declaración
  // NUEVA: un reintento idempotente no vuelve a sonar la campana.
  if (estado === 'applied') {
    await admin.from('notifications').insert({
      body: `Pago informado · pedido ${order.external_ref ?? order.id} · verifica que cayó y regístralo`,
      roles: ['admin'], screen: 'av_pagos',
    }).then(() => {}, () => {})
  }

  return json(200, { ok: true, status: estado ?? 'applied', claim_id: (res as { claim_id?: string } | null)?.claim_id, op_id: opId })
})
