// Edge Function: CFDI — CONTENIDA (W3-A · punto 8 del diseño congelado).
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTA FUNCIÓN YA NO TIMBRA
//
// La versión anterior tenía este camino, y bastaba un timeout para recorrerlo:
//
//   POST /3/cfdis (sin timeout)  → el PAC PUDO timbrar
//   → se pierde la respuesta     → el cliente marcaba el fallo
//   → el cliente escribía invoice_meta = null   ← se destruía la evidencia
//   → la UI volvía a ofrecer "Emitir CFDI"      → segundo POST
//   → DOS CFDI reales ante el SAT por un solo pedido
//
// Además persistía status:'timbrada' aunque el cuerpo del PAC viniera vacío o sin
// UUID, no verificaba el resultado de la escritura, no tenía reclamo atómico y su
// URL base caía por defecto a PRODUCCIÓN del PAC.
//
// W3-A no "cambia el mensaje": ELIMINA la salida al PAC de este archivo. No hay
// salida de red, no hay credenciales, no hay escritura sobre el pedido. El camino peligroso
// deja de existir mientras se construye el seguro.
//
// LO QUE SÍ EXISTE YA (W3-A, en la base de datos):
//   · solicitar_cfdi()        intención fiscal durable, con receptor congelado
//   · fiscal_documents        estados pendiente/en_proceso/timbrado/fallido/incierto/cancelado
//   · reclamar_cfdi()         reclamo atómico que además fija serie, folio y Date
//                             (W3-B retiró _w3_reclamar: un reclamo sin identidad ante
//                             el proveedor ya no es un estado válido)
//   · conciliar_cfdi()        conciliación local
//   · orders_guard            invoice_meta/invoice_requested ya no los escribe el cliente
//
// LO QUE FALTA (W3-B): el timbrado real con timeout, clasificación de errores,
// semántica de `incierto` y recuperación de timbre huérfano. Hasta entonces, timbrar
// desde aquí sería volver a abrir el mismo agujero.
//
// Las reglas puras que esta función usaba (receptor canónico sin defaults, gate de
// pago, lugar de expedición, idempotencia del timbre) NO se perdieron: viven en
// ./rules.ts, probadas, listas para que W3-B las aplique sobre la intención durable.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  // Se conserva el control de acceso: una sonda anónima no aprende nada del estado fiscal.
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const who = { user: { id: q.quien.uid } }
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'Solo Dirección/Facturación puede timbrar.' })

  // CONTENCIÓN. Ni red, ni credenciales, ni escritura. 423 = bloqueado a propósito.
  return json(423, {
    error: 'w3_contencion',
    message: 'El timbrado de CFDI está temporalmente bloqueado mientras se instala el nuevo camino fiscal. La solicitud de factura sí queda registrada y no se pierde. Dirección habilitará la emisión al completar W3-B.',
    fiscal_intent: 'solicitar_cfdi',
  })
}))
