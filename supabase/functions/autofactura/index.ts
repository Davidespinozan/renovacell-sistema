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
//   descargar  — sin sesión, con la llave del enlace Y el RFC de la factura. Entrega el PDF o el XML de una factura
//                YA timbrada (misma lectura a Facturama que la descarga del personal). Solo lectura.
//
// La llave es un HMAC del pedido con un secreto del servidor: no se guarda y no se puede fabricar. Viaja solo en el
// cuerpo (nunca en la URL de esta función). Lo público tiene límite por IP y techo global.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import {
  correoEnmascarado, diaNegocio, enlaceFactura, estadoAutofactura, faltaEnReceptor, fechaLimite, limpiarReceptor, llaveDePedido,
  llaveValida, mensajeDeError, MENSAJE_ESTADO, rfcIgual, URL_SISTEMA,
} from '../_shared/autofactura.ts'
import { formatoValido, mimeDe, nombreArchivo, puedeDescargar } from '../cfdi-download/rules.ts'
import { resolverFacturama } from '../_shared/facturama.ts'

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

  const b = await req.json().catch(() => ({})) as { accion?: string; pedidos?: unknown; pedido?: string; llave?: string; receptor?: unknown; rfc?: string; formato?: unknown }
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

  if (accion !== 'ver' && accion !== 'solicitar' && accion !== 'descargar') return json(400, { error: 'accion_invalida' })

  // ── público: límite antes de mirar nada (también frena adivinar llaves) ──
  const sujeto = await sujetoPublico(req)
  const v = await limitarTodas(admin, accion === 'ver'
    ? [{ scope: 'autofactura_ver', sujeto }, { scope: 'autofactura_ver_global', sujeto: 'global' }]
    : accion === 'descargar'
    ? [{ scope: 'autofactura_descargar', sujeto }, { scope: 'autofactura_descargar_global', sujeto: 'global' }]
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

  // ── descargar: solo una factura YA timbrada, y solo a quien además sabe a qué RFC se facturó ──
  if (accion === 'descargar') {
    if (!formatoValido(b.formato)) return json(422, { error: 'formato', message: 'Elige PDF o XML.' })
    const { data: o } = await admin.from('orders').select('external_ref, invoice_meta').eq('id', pedido).maybeSingle()
    if (!o) return json(404, NO_EXISTE)
    const meta = (o.invoice_meta ?? {}) as { receiver?: { rfc?: string } }
    const gate = puedeDescargar(o.invoice_meta)
    if (!gate.ok) return json(409, { error: 'sin_factura', message: 'Tu factura todavía no está lista para descargar.' })
    if (!rfcIgual(b.rfc, meta.receiver?.rfc)) return json(403, { error: 'rfc', message: 'Ese RFC no coincide con el de la factura. Escríbelo tal como lo capturaste.' })
    const usuario = Deno.env.get('FACTURAMA_USER'); const clave = Deno.env.get('FACTURAMA_PASSWORD')
    const fac = resolverFacturama(Deno.env.get('FACTURAMA_ENV'))
    if (!usuario || !clave || !fac.ok) return json(503, { error: 'no_disponible', message: 'La descarga no está disponible en este momento. Revisa tu correo o pídela a tu asesor.' })
    // Misma lectura que la descarga del personal (cfdi-download): el identificador sale de la base, nunca del cliente.
    const r = await fetch(`${fac.base}/api/Cfdi/${b.formato}/issued/${gate.facturamaId}`, { headers: { Authorization: 'Basic ' + btoa(`${usuario}:${clave}`), Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }).catch(() => null)
    const cuerpo = r ? await r.json().catch(() => ({})) as { Content?: string } : {}
    if (!r || !r.ok || !cuerpo.Content) return json(502, { error: 'proveedor', message: 'No se pudo obtener tu factura en este momento. Intenta de nuevo en unos minutos.' })
    return json(200, { filename: nombreArchivo(o.external_ref, gate.uuid, b.formato), contentType: mimeDe(b.formato), base64: cuerpo.Content })
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
