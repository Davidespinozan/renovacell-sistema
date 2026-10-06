// CC-4 · ADAPTADOR DE PROVEEDOR (puro, sin imports; fetch y env se inyectan). El dominio habla
// con `Proveedor.generar`; Anthropic es la implementación actual. Un proveedor falso determinista
// sirve para el harness: nunca se llama al proveedor real en pruebas.
//
// Anthropic Messages API (auditado en la Edge `assistant` legacy): POST /v1/messages con
// `tools` [{name, description, input_schema}]; la respuesta trae bloques `text` y `tool_use`
// {id, name, input} y `stop_reason` ('end_turn' | 'tool_use' | 'max_tokens'). Los resultados se
// devuelven como bloques `tool_result` {tool_use_id, content} en un mensaje `user`.

export type BloqueEntrada =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
// Los mensajes aceptan bloques genéricos (el orquestador los arma); los bloques que ESTE módulo produce son BloqueEntrada.
export type BloqueGenerico = { type: string; [k: string]: unknown }
export interface MensajeModelo { role: 'user' | 'assistant'; content: string | BloqueGenerico[] }
export interface SolicitudModelo { system: string; messages: MensajeModelo[]; tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>; max_tokens: number; timeoutMs: number }
export interface LlamadaHerramienta { id: string; name: string; input: Record<string, unknown> }
export type ClaseError = 'provider_timeout' | 'provider_rate_limited' | 'provider_error' | 'provider_auth' | 'provider_malformed' | 'provider_unavailable'
export type RespuestaModelo =
  | { tipo: 'texto'; texto: string; usage: Uso; stop: string }
  | { tipo: 'herramientas'; texto: string; llamadas: LlamadaHerramienta[]; bloques: BloqueEntrada[]; usage: Uso; stop: string }
  | { tipo: 'error'; clase: ClaseError; usage: Uso; ambiguo: boolean }
export interface Uso { input: number; output: number }
export interface Proveedor { nombre: string; modelo: string; generar: (s: SolicitudModelo) => Promise<RespuestaModelo> }

export interface ConfigIA { provider: 'anthropic'; model: string; timeoutMs: number; maxTokens: number; maxRondas: number; historial: number }
export const MODELO_DEFAULT = 'claude-haiku-4-5-20251001'   // el mismo del assistant legacy: tool use, baja latencia, costo bajo (D-CC4-01)

/** Config desde el entorno; falla cerrado (null) si el proveedor es desconocido o falta la credencial. */
export function configurar(env: (k: string) => string | undefined): { ok: true; config: ConfigIA; key: string } | { ok: false; motivo: 'no_configurado' | 'proveedor_desconocido' } {
  const provider = (env('AI_PROVIDER') ?? 'anthropic').trim().toLowerCase()
  if (provider !== 'anthropic') return { ok: false, motivo: 'proveedor_desconocido' }
  const key = env('ANTHROPIC_API_KEY')?.trim()
  if (!key) return { ok: false, motivo: 'no_configurado' }
  const num = (k: string, d: number, min: number, max: number) => { const v = Number(env(k)); return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d }
  const model = (env('AI_MODEL') ?? env('ANTHROPIC_MODEL') ?? MODELO_DEFAULT).trim() || MODELO_DEFAULT
  return { ok: true, key, config: { provider: 'anthropic', model, timeoutMs: num('AI_TIMEOUT_MS', 20_000, 2_000, 60_000), maxTokens: num('AI_MAX_TOKENS', 600, 100, 2_000), maxRondas: num('AI_MAX_TOOL_ROUNDS', 4, 1, 6), historial: num('AI_HISTORY_MESSAGES', 12, 2, 30) } }
}

/** Normaliza la respuesta JSON de Anthropic. Malformada → error (nunca se interpreta texto a ciegas). */
export function parsearAnthropic(status: number, data: unknown): RespuestaModelo {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const u = (d.usage && typeof d.usage === 'object' ? d.usage : {}) as Record<string, unknown>
  const usage: Uso = { input: Number(u.input_tokens ?? 0) || 0, output: Number(u.output_tokens ?? 0) || 0 }
  if (status === 401 || status === 403) return { tipo: 'error', clase: 'provider_auth', usage, ambiguo: false }
  if (status === 429) return { tipo: 'error', clase: 'provider_rate_limited', usage, ambiguo: false }
  if (status === 529 || status === 503) return { tipo: 'error', clase: 'provider_unavailable', usage, ambiguo: false }
  if (status < 200 || status >= 300) return { tipo: 'error', clase: 'provider_error', usage, ambiguo: false }
  if (!Array.isArray(d.content)) return { tipo: 'error', clase: 'provider_malformed', usage, ambiguo: false }
  const bloques: BloqueEntrada[] = []; const llamadas: LlamadaHerramienta[] = []; const textos: string[] = []
  for (const b of d.content as Array<Record<string, unknown>>) {
    if (!b || typeof b !== 'object') return { tipo: 'error', clase: 'provider_malformed', usage, ambiguo: false }
    if (b.type === 'text' && typeof b.text === 'string') { textos.push(b.text); bloques.push({ type: 'text', text: b.text }) }
    else if (b.type === 'tool_use') {
      if (typeof b.id !== 'string' || typeof b.name !== 'string') return { tipo: 'error', clase: 'provider_malformed', usage, ambiguo: false }
      const input = (b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : {}) as Record<string, unknown>
      llamadas.push({ id: b.id, name: b.name, input }); bloques.push({ type: 'tool_use', id: b.id, name: b.name, input })
    }
  }
  const stop = typeof d.stop_reason === 'string' ? d.stop_reason : 'end_turn'
  if (llamadas.length) return { tipo: 'herramientas', texto: textos.join('\n').trim(), llamadas, bloques, usage, stop }
  return { tipo: 'texto', texto: textos.join('\n').trim(), usage, stop }
}

export function crearProveedorAnthropic(deps: { key: string; model: string; fetch: typeof fetch; url?: string }): Proveedor {
  const url = deps.url ?? 'https://api.anthropic.com/v1/messages'
  return {
    nombre: 'anthropic', modelo: deps.model,
    async generar(s) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), s.timeoutMs)
      try {
        const body: Record<string, unknown> = { model: deps.model, max_tokens: s.max_tokens, system: s.system, messages: s.messages }
        if (s.tools.length) body.tools = s.tools
        const r = await deps.fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': deps.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const data = await r.json().catch(() => null)
        return parsearAnthropic(r.status, data)
      } catch (e) {
        // Abort = timeout: el proveedor PUDO haber respondido (ambiguo); la persistencia es idempotente por turno.
        const esAbort = (e as { name?: string })?.name === 'AbortError'
        return { tipo: 'error', clase: esAbort ? 'provider_timeout' : 'provider_unavailable', usage: { input: 0, output: 0 }, ambiguo: esAbort }
      } finally { clearTimeout(t) }
    },
  }
}

/** Proveedor FALSO determinista para pruebas: devuelve el guion en orden; registra las solicitudes. */
export function crearProveedorFalso(guion: Array<RespuestaModelo | ((s: SolicitudModelo) => RespuestaModelo | Promise<RespuestaModelo>)>, opts: { modelo?: string } = {}): Proveedor & { solicitudes: SolicitudModelo[] } {
  const solicitudes: SolicitudModelo[] = []; let i = 0
  return {
    nombre: 'falso', modelo: opts.modelo ?? 'falso-1', solicitudes,
    async generar(s) {
      solicitudes.push(s)
      const paso = guion[Math.min(i, guion.length - 1)]; i++
      if (!paso) return { tipo: 'error', clase: 'provider_malformed', usage: { input: 0, output: 0 }, ambiguo: false }
      return typeof paso === 'function' ? await paso(s) : paso
    },
  }
}
export const respuestaTexto = (texto: string, usage: Uso = { input: 100, output: 50 }): RespuestaModelo => ({ tipo: 'texto', texto, usage, stop: 'end_turn' })
export const respuestaHerramientas = (llamadas: Array<{ name: string; input: Record<string, unknown>; id?: string }>, texto = '', usage: Uso = { input: 120, output: 40 }): RespuestaModelo => {
  const ll = llamadas.map((l, k) => ({ id: l.id ?? `tu_${k + 1}`, name: l.name, input: l.input }))
  return { tipo: 'herramientas', texto, llamadas: ll, bloques: [...(texto ? [{ type: 'text', text: texto } as BloqueEntrada] : []), ...ll.map((l) => ({ type: 'tool_use', id: l.id, name: l.name, input: l.input } as BloqueEntrada))], usage, stop: 'tool_use' }
}
