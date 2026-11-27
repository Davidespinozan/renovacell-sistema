// Edge Function (se despliega con --no-verify-jwt; valida ella misma): AUTOFACTURA POR QR.
//
// El recibo y la remisión llevan un QR con el enlace de ESA compra. El cliente lo abre sin sesión, captura sus datos
// fiscales y la factura queda PEDIDA; Facturación la timbra con un clic. Esta función no timbra y no sale al PAC.
//
// Acciones:
//   enlaces    — con sesión del personal. Devuelve el enlace de las compras que ESA persona ya puede ver (lo decide la
//                base con su JWT). Lo usan el recibo y la remisión para pintar el QR.
//   ver        — sin sesión, con la llave del enlace. Folio, fecha, total, fecha límite y en qué va la factura.
//   solicitar  — sin sesión, con la llave del enlace. Registra la solicitud con los datos fiscales (misma orden
//                `solicitar_cfdi` que usa el personal: aplica la regla del mes y la de la factura global).
//
// La llave es un HMAC del pedido con un secreto del servidor: no se guarda y no se puede fabricar. Viaja solo en el
// cuerpo (nunca en la URL de esta función). Lo público tiene límite por IP y techo global.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import {
  correoEnmascarado, diaNegocio, enlaceFactura, estadoAutofactura, faltaEnReceptor, fechaLimite, limpiarReceptor, llaveDePedido,
  llaveValida, mensajeDeError, MENSAJE_ESTADO, URL_SISTEMA,
} from '../_shared/autofactura.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_EXISTE = { error: 'enlace', message: 'Este enlace no es válido. Revisa que el código de tu recibo se haya leído completo.' }

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // Secreto propio si existe; si no, se deriva de la llave del servidor (que ya es secreta y solo vive aquí).
  const secreto = (Deno.env.get('AUTOFACTURA_SECRET') ?? '').trim() || servicio
  const admin = createClient(url, servicio, { auth: { persistSession: false } })
  const base = Deno.env.get('AUTOFACTURA_URL_BASE') ?? URL_SISTEMA

  const b = await req.json().catch(() => ({})) as { accion?: string; pedidos?: unknown; pedido?: string; llave?: string; receptor?: unknown }
  const accion = b.accion ?? ''

  // ── enlaces: personal con sesión; solo de las compras que su sesión ya puede leer ──
  if (accion === 'enlaces') {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    if (q.quien.role === 'doctor' || q.quien.role === '') return json(403, { error: 'no_autorizado' })
    const v = await limitarTodas(admin, [{ scope: 'autofactura_enlaces_uid', sujeto: sujetoUid(q.quien.uid) }])
    if (!v.permitido) return respuestaLimite(v)
    const ids = [...new Set((Array.isArray(b.pedidos) ? b.pedidos : []).filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 50)
    if (!ids.length) return json(200, { enlaces: {} })
    const { data, error } = await caller.from('orders').select('id, created_at').in('id', ids)   // RLS de quien pregunta
    if (error) return json(503, { error: 'no_disponible', message: 'No se pudieron leer los pedidos.' })
    const enlaces: Record<string, { url: string; limite: string }> = {}
    for (const o of (data ?? []) as Array<{ id: string; created_at: string }>) {
      enlaces[o.id] = { url: enlaceFactura(o.id, await llaveDePedido(o.id, secreto), base), limite: fechaLimite(o.created_at) }
    }
    return json(200, { enlaces })
  }

  if (accion !== 'ver' && accion !== 'solicitar') return json(400, { error: 'accion_invalida' })

  // ── público: límite antes de mirar nada (también frena adivinar llaves) ──
  const sujeto = await sujetoPublico(req)
  const v = await limitarTodas(admin, accion === 'ver'
    ? [{ scope: 'autofactura_ver', sujeto }, { scope: 'autofactura_ver_global', sujeto: 'global' }]
    : [{ scope: 'autofactura_solicitar', sujeto }, { scope: 'autofactura_solicitar_global', sujeto: 'global' }])
  if (!v.permitido) return respuestaLimite(v)

  const pedido = typeof b.pedido === 'string' ? b.pedido.toLowerCase() : ''
  if (!(await llaveValida(pedido, typeof b.llave === 'string' ? b.llave : '', secreto))) return json(404, NO_EXISTE)

  const leer = async () => {
    const { data: o } = await admin.from('orders').select('id, external_ref, created_at, total, status, payment_status, invoice_meta').eq('id', pedido).maybeSingle()
    if (!o) return null
    const { data: doc } = await admin.from('fiscal_documents').select('status, receiver').eq('order_id', pedido).eq('kind', 'ingreso')
      .in('status', ['pendiente', 'en_proceso', 'timbrado', 'incierto']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { data: glob } = await admin.rpc('_pedido_en_global', { p_order: pedido })
    const meta = (o.invoice_meta ?? {}) as { status?: string; receiver?: Record<string, string> }
    const estado = estadoAutofactura({
      status_pedido: o.status, venta: o.created_at, hoy: diaNegocio(new Date()),
      fiscal_status: doc?.status ?? null, timbrada: meta.status === 'timbrada' || meta.status === 'emitida', en_global: glob === true,
    })
    const rec = (doc?.receiver ?? meta.receiver ?? null) as Record<string, string> | null
    return {
      estado, mensaje: MENSAJE_ESTADO[estado], folio: o.external_ref as string | null, fecha: diaNegocio(o.created_at), total: Number(o.total ?? 0),
      limite: fechaLimite(o.created_at), pagado: o.payment_status === 'paid',
      // Lo ya capturado se devuelve SOLO mientras se puede corregir, a quien trae la llave del recibo; el correo, enmascarado.
      receptor: estado === 'solicitada' && rec ? { rfc: rec.rfc ?? '', razon_social: rec.razon_social ?? '', regimen: rec.regimen ?? '', cp: rec.cp ?? '', uso_cfdi: rec.uso_cfdi ?? '', correo: correoEnmascarado(rec.email_facturacion) } : null,
    }
  }

  if (accion === 'ver') {
    const r = await leer()
    return r ? json(200, r) : json(404, NO_EXISTE)
  }

  // ── solicitar ──
  const antes = await leer()
  if (!antes) return json(404, NO_EXISTE)
  if (antes.estado !== 'disponible' && antes.estado !== 'solicitada') return json(409, { estado: antes.estado, message: antes.mensaje })
  const receptor = limpiarReceptor(b.receptor)
  const falta = faltaEnReceptor(receptor)
  if (falta) return json(400, { error: 'datos', message: falta })
  const { error } = await admin.rpc('solicitar_cfdi', { p_op_id: crypto.randomUUID(), p_order_id: pedido, p_receiver: receptor })
  if (error) {
    const e = mensajeDeError(error.message)
    return json(409, { estado: e.estado, message: e.mensaje })
  }
  const despues = await leer()
  return json(200, despues ?? { estado: 'solicitada', mensaje: MENSAJE_ESTADO.solicitada })
}))
