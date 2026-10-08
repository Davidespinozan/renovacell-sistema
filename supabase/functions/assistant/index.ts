// Edge Function: ASISTENTE IA (modelo real) para el Portal del Doctor y la landing.
// Llama a la API de Anthropic con la llave PROTEGIDA en el servidor. Dos modos con
// distintas reglas de seguridad:
//   - 'doctor': concierge de pedidos del médico verificado (info de catálogo, sin
//               consejo clínico ni dosis).
//   - 'landing': orientación pública que informa y SIEMPRE empuja a verificarse
//                (Renovacell vende solo a profesionales; nunca precios ni venta).
//
// SEAM: sin ANTHROPIC_API_KEY responde 501 → el cliente usa su motor local (mock).
// Activar = `supabase secrets set ANTHROPIC_API_KEY=...` (opcional ANTHROPIC_MODEL).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { limitar, limitarTodas, respuestaLimite, sujetoPublico, sujetoUid, tokensEstimados } from '../_shared/limite.ts'
import { resolverQuien } from '../_shared/quien.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
function catalogText(products: any[]): string {
  if (!Array.isArray(products) || products.length === 0) return '(sin catálogo provisto)'
  return products.slice(0, 120).map((p) => {
    // Topa longitudes: el catálogo va en el prompt de sistema; nombres/categorías del cliente
    // no deben poder inflarlo ni inyectar instrucciones largas.
    const name = String(p.name ?? '').slice(0, 80)
    const category = p.category ? String(p.category).slice(0, 60) : ''
    const line = p.line === 'prof' ? 'Professional' : p.line === 'cosm' ? 'Home Care' : (typeof p.line === 'string' ? p.line.slice(0, 20) : '')
    return `- ${name}${category ? ` (${category})` : ''}${line ? ` · ${line}` : ''}`
  }).join('\n')
}

function systemPrompt(mode: string, products: unknown[]): string {
  const cat = catalogText(products as [])
  if (mode === 'landing') {
    return [
      'Eres el asistente del sitio PÚBLICO de Renovacell, empresa de medicina regenerativa de',
      'grado médico (tecnología S2RM®, certificación CE, registro COFEPRIS). Orientas al visitante',
      'y despiertas interés. Renovacell vende SOLO a profesionales de la salud con cédula',
      'verificada; la compra ocurre en el portal DESPUÉS de verificarse.',
      '',
      'CÓMO HABLAS (muy importante):',
      '- Como una persona real en un chat de WhatsApp: cálido, cercano y BREVE, 1 a 3 frases.',
      '- TEXTO PLANO. Nada de formato: sin negritas, sin viñetas ni listas numeradas, sin',
      '  encabezados, sin líneas divisorias (---), sin tablas. Escribe en frases normales.',
      '- Una idea a la vez: conversa y haz UNA sola pregunta, no sueltes todo de golpe.',
      '- Como mucho un emoji ocasional, NO en cada mensaje. Español de México, natural,',
      '  que no suene a folleto ni a robot.',
      '',
      'QUÉ HACES:',
      '- Informas de la marca y los productos de forma general, solo informativa.',
      '- Cuando el visitante quiera comprar, acceder o saber más, invítalo a verificar su',
      '  cédula para entrar al portal — de forma natural y solo cuando venga al caso, NO en',
      '  cada mensaje.',
      '- CAPTACIÓN: si muestra interés real, pídele su nombre y su WhatsApp o correo. En',
      '  cuanto tengas nombre + un contacto, LLAMA a la herramienta save_prospect para',
      '  canalizarlo con un asesor, y confírmale en una frase que lo contactarán.',
      '',
      'NUNCA: des precios ni cierres ventas; des consejo clínico, dosis o indicaciones de uso;',
      'inventes productos (usa solo la lista de abajo).',
      '', 'Productos (informativo):', cat,
    ].join('\n')
  }
  return [
    'Eres el asistente del Portal del Doctor de Renovacell (el usuario es un médico ya verificado).',
    'Conoces el catálogo y ayudas a elegir productos, compararlos, entender para qué sirve cada',
    'uno y armar o reordenar pedidos.',
    '',
    'CÓMO RESPONDES:',
    '- Con sustancia y claridad. Da el detalle que la pregunta amerite: si te piden comparar o',
    '  recomendar, explica el porqué y las diferencias; no contestes de una sola línea. Pero ve al',
    '  grano, sin relleno ni frases de venta.',
    '- Prosa natural en español de México, tono profesional y cercano. Puedes usar una lista corta',
    '  SOLO cuando compares varias opciones; sin negritas por todos lados ni encabezados.',
    '',
    'QUÉ HACES:',
    '- Recomiendas productos del catálogo según lo que describe el doctor (objetivo estético, tipo',
    '  de piel, línea Professional o Home Care) y explicas la diferencia entre opciones.',
    '- Si quiere ordenar, pídele el producto y la cantidad.',
    '',
    'LÍMITES (cliente regulado):',
    '- Puedes describir PARA QUÉ está pensado un producto en general, pero NO das dosis,',
    '  indicaciones de uso ni consejo clínico para un paciente concreto: para eso remite a la ficha',
    '  técnica del producto o a un especialista.',
    '- Usa SOLO los productos del catálogo de abajo; no inventes productos ni precios.',
    '', 'Catálogo disponible:', cat,
  ].join('\n')
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json(501, { error: 'not_configured', message: 'Asistente IA no habilitado. Agrega ANTHROPIC_API_KEY.' })
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5-20251001'

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const mode = p.mode === 'landing' ? 'landing' : 'doctor'

  const sbUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const caller = createClient(sbUrl, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })

  // El concierge del doctor exige sesión (no debe alcanzarse con la sola clave anon, ni
  // usarse como proxy gratis a la API de Anthropic). La landing SÍ es pública por diseño.
  let uid: string | null = null
  if (mode === 'doctor') {
    const q = await resolverQuien(caller, createClient(sbUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }))
    if (!q.ok) return json(q.status, q.body)
    uid = q.quien.uid
  }

  // CC-0B · Frontera de abuso: ráfaga por sujeto (uid o IP) y techo global por hora. La
  // autoridad es la base (rate_limit_hit, solo service_role); este cliente NO se usa para
  // nada más. Si el limitador no responde, se cierra (503): nunca se llama al modelo a ciegas.
  const limitador = createClient(sbUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const sujeto = uid ? sujetoUid(uid) : await sujetoPublico(req)
  const rafaga = mode === 'landing'
    ? [{ scope: 'assistant_landing_burst', sujeto }, { scope: 'assistant_landing_hora', sujeto }, { scope: 'assistant_landing_global', sujeto: 'global' }]
    : [{ scope: 'assistant_doctor_burst', sujeto }]
  const veredicto = await limitarTodas(limitador, rafaga)
  if (!veredicto.permitido) return respuestaLimite(veredicto)

  // CC-0A · El catálogo que el modelo considera verdadero lo carga el SERVIDOR desde la
  // fuente autorizada para cada modo: `catalog_public` (anon, sin precio) en la landing y
  // `products_safe` (la RLS del llamante: solo un doctor verificado ve filas) en el portal.
  // `p.products` era el contrato viejo del cliente: se IGNORA; nunca es autoridad.
  // Si la carga falla, el modelo trabaja sin catálogo (y así lo dice) antes que con uno ajeno.
  // deno-lint-ignore no-explicit-any
  let products: any[] = []
  try {
    const r = mode === 'landing'
      ? await createClient(sbUrl, anon, { auth: { persistSession: false } }).from('catalog_public').select('name, line, category').order('category').order('name').limit(120)
      : await caller.from('products_safe').select('name, line, category').eq('active', true).eq('show_portal', true).order('category').order('name').limit(120)
    products = Array.isArray(r.data) ? r.data : []
  } catch { products = [] }

  // deno-lint-ignore no-explicit-any
  const history: any[] = Array.isArray(p.messages) ? p.messages : []
  // Topes de entrada (evita prompts gigantes / abuso): máx 12 turnos, 4000 chars por turno.
  const messages = history.length > 0
    ? history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [{ role: 'user', content: String(p.text ?? '').slice(0, 2000) }]
  if (!messages.length || !messages.some((m) => m.role === 'user')) return json(400, { error: 'Falta el mensaje.' })

  // CC-0B · Techo de COSTO diario (tokens): se pre-carga la estimación ANTES de llamar al
  // modelo (global y, si hay sesión, por uid); al volver se ajusta con el consumo real.
  // Excedido → 429 sin llamar a Anthropic.
  const maxTokens = mode === 'doctor' ? 900 : 500
  const estimado = tokensEstimados(messages.map((m) => m.content), maxTokens)
  const costo = await limitarTodas(limitador, [
    { scope: 'assistant_tokens_dia', sujeto: 'global', costo: estimado },
    ...(uid ? [{ scope: 'assistant_tokens_dia_uid', sujeto, costo: estimado }] : []),
  ])
  if (!costo.permitido) return respuestaLimite(costo)

  // En la landing, el agente CAPTA el prospecto: cuando el visitante da su nombre + un
  // contacto, el modelo llama a esta herramienta y el cliente crea el lead (→ ventas).
  const tools = mode === 'landing' ? [{
    name: 'save_prospect',
    description: 'Canaliza al visitante interesado con un asesor de ventas. Úsala SOLO cuando ya tengas su NOMBRE y un CONTACTO (WhatsApp o correo).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre del profesional' },
        phone: { type: 'string', description: 'WhatsApp/teléfono' },
        email: { type: 'string', description: 'Correo' },
        interest: { type: 'string', description: 'Producto o interés mencionado' },
      },
      required: ['name'],
    },
  }] : undefined

  try {
    // deno-lint-ignore no-explicit-any
    // El doctor pide recomendaciones/comparaciones: dale margen para responder con
    // sustancia. La landing es captación breve, con menos.
    const body: any = { model, max_tokens: maxTokens, system: systemPrompt(mode, products), messages }
    if (tools) body.tools = tools
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    // CC-0B · consumo real: se corrige la pre-carga (puede ser negativo). Nunca bloquea.
    const usados = Number(data?.usage?.input_tokens ?? 0) + Number(data?.usage?.output_tokens ?? 0)
    if (usados > 0 && usados !== estimado) {
      await limitar(limitador, 'assistant_tokens_dia', 'global', { costo: usados - estimado })
      if (uid) await limitar(limitador, 'assistant_tokens_dia_uid', sujeto, { costo: usados - estimado })
    }
    if (!r.ok) return json(502, { error: 'anthropic', message: data?.error?.message ?? 'Error del modelo.' })
    // deno-lint-ignore no-explicit-any
    const blocks: any[] = data?.content ?? []
    const text = blocks.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
    // ¿el modelo capturó un prospecto? (tool_use). El cliente lo manda a capture-lead.
    const toolCall = blocks.find((c) => c.type === 'tool_use' && c.name === 'save_prospect')
    const lead = toolCall?.input ?? null
    return json(200, {
      text: text || (lead ? '¡Perfecto! Ya te canalicé con un asesor; te contactará en breve. Para ver catálogo y precios, verifica tu cédula y entra al portal.' : 'Con gusto te ayudo. ¿Puedes darme un poco más de detalle?'),
      lead,
    })
  } catch (_e) {
    // No filtrar el detalle interno al cliente.
    return json(502, { error: 'No se pudo contactar al asistente. Intenta de nuevo.' })
  }
}, undefined, 'landing'))   // CX-0B · solo la landing la llama: sin la puerta del portal
