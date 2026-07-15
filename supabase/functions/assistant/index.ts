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
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
function catalogText(products: any[]): string {
  if (!Array.isArray(products) || products.length === 0) return '(sin catálogo provisto)'
  return products.slice(0, 60).map((p) => {
    const line = p.line === 'prof' ? 'Professional' : p.line === 'cosm' ? 'Home Care' : (p.line ?? '')
    return `- ${p.name}${p.category ? ` (${p.category})` : ''}${line ? ` · ${line}` : ''}`
  }).join('\n')
}

function systemPrompt(mode: string, products: unknown[]): string {
  const cat = catalogText(products as [])
  if (mode === 'landing') {
    return [
      'Eres el asistente de orientación del sitio PÚBLICO de Renovacell, empresa de',
      'medicina regenerativa de grado médico (tecnología S2RM®, certificación CE, registro COFEPRIS).',
      'Tu meta: informar y generar interés, y SIEMPRE orientar a que el visitante SOLICITE',
      'ACCESO / SE VERIFIQUE. Renovacell vende SOLO a profesionales de la salud con cédula',
      'verificada; la compra ocurre en el portal DESPUÉS de verificarse.',
      'Reglas: (1) NUNCA des precios ni cierres ventas. (2) NUNCA des consejo clínico, dosis',
      'ni indicaciones de uso. (3) Menciona productos solo de forma informativa. (4) Responde',
      'breve y cordial en español de México, y cierra invitando a verificarse/solicitar acceso.',
      '(5) CAPTACIÓN: si el visitante muestra interés (quiere comprar, acceder, más info),',
      'pídele su NOMBRE y su WhatsApp o correo. En cuanto tengas nombre + un contacto, LLAMA a',
      'la herramienta save_prospect para canalizarlo con un asesor de ventas, y confírmale que',
      'lo contactarán pronto y que verifique su cédula para entrar al portal.',
      '', 'Productos (informativo):', cat,
    ].join('\n')
  }
  return [
    'Eres el asistente de Renovacell en el Portal del Doctor (usuario: médico ya verificado).',
    'Ayudas con: información de PRODUCTOS del catálogo, armar o reordenar pedidos, y dudas',
    'generales de la marca. Reglas: (1) NO das consejo clínico, dosis ni indicaciones de uso',
    '— para eso remite a la ficha técnica del producto o a un especialista. (2) No inventes',
    'productos ni precios; usa solo el catálogo dado. (3) Responde breve y cordial en español',
    'de México. Si el doctor quiere ordenar, guíalo a decir el producto y la cantidad.',
    '', 'Catálogo disponible:', cat,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json(501, { error: 'not_configured', message: 'Asistente IA no habilitado. Agrega ANTHROPIC_API_KEY.' })
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5-20251001'

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const mode = p.mode === 'landing' ? 'landing' : 'doctor'
  // deno-lint-ignore no-explicit-any
  const history: any[] = Array.isArray(p.messages) ? p.messages : []
  const messages = history.length > 0
    ? history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
    : [{ role: 'user', content: String(p.text ?? '').slice(0, 2000) }]
  if (!messages.length || !messages.some((m) => m.role === 'user')) return json(400, { error: 'Falta el mensaje.' })

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
    const body: any = { model, max_tokens: 500, system: systemPrompt(mode, p.products ?? []), messages }
    if (tools) body.tools = tools
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
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
  } catch (e) {
    return json(502, { error: `Error con el modelo: ${(e as Error).message}` })
  }
})
