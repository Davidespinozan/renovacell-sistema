// CONTACTO CONVERSACIONAL (dueño, 30 oct) · sin formulario: la IA pide nombre, celular y correo platicando y los registra
// con registrar_contacto, que SOLO existe para el visitante del portal que aún no los deja. Un dato inválido regresa como
// `campo` para pedirlo de nuevo. La política le dice con quién va a hablar y quién lo recomendó.
import { describe, it, expect } from 'vitest'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas, type SolicitudModelo } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'

const CONV = '99999999-9999-4999-8999-999999999999'
function base(respuestaRegistro: unknown) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [], error: null }
      case 'cc_ia_estado_handoff': return { data: { modo: 'ai_active', horario_configurado: true, en_horario: true }, error: null }
      case 'cc_ia_registrar_contacto': return { data: respuestaRegistro, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'x', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true }, error: null }
    }
    return { data: null, error: { message: 'fn ' + fn } }
  }
  return { rpc, llamadas }
}
const deps = (db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0]): DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> } => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'ai', content: 'Hola… ¿cómo te llamas?' }, { actor: 'visitor', content: 'Ana Ruiz, 669 111 2233, ana@correo.com' }], proveedor: crearProveedorFalso(guion),
  config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 4, historial: 12 }, politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
})
const PEND = { pendiente: true, asesor: 'Roberto', recomienda: 'Lourdes' }
const entrada = (contacto: typeof PEND | null) => ({ conv: CONV, triggerSeq: 5, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'Ana Ruiz, 669 111 2233, ana@correo.com', contacto })

describe('contacto conversacional', () => {
  it('solo el visitante del portal SIN datos tiene registrar_contacto', () => {
    const n = (xs: Array<{ name: string }>) => xs.map((x) => x.name)
    expect(n(herramientas.herramientasPara(false, 'portal', true))).toContain('registrar_contacto')
    expect(n(herramientas.herramientasPara(false, 'portal', false))).not.toContain('registrar_contacto')
    expect(n(herramientas.herramientasPara(true, 'portal', true))).not.toContain('registrar_contacto')     // con cuenta, nunca
    expect(n(herramientas.herramientasPara(false, 'whatsapp', true))).not.toContain('registrar_contacto')  // en canales, nunca
    const ok = herramientas.validarLlamada('registrar_contacto', { nombre: 'Ana Ruiz', telefono: '669 111 2233', email: 'ana@correo.com' }, { conCuenta: false, idsAutorizados: new Set(), canal: 'portal', contactoPendiente: true })
    expect(ok).toEqual({ ok: true, nombre: 'registrar_contacto', args: { nombre: 'Ana Ruiz', telefono: '669 111 2233', email: 'ana@correo.com', es_medico: false, cedula: null }, ids: [] })
    expect(herramientas.validarLlamada('registrar_contacto', { nombre: 'Ana Ruiz', telefono: '6691112233', email: 'ana@correo.com' }, { conCuenta: false, idsAutorizados: new Set(), canal: 'portal', contactoPendiente: false })).toEqual({ ok: false, motivo: 'no_autorizada' })
    expect(herramientas.validarLlamada('registrar_contacto', { nombre: 'Ana Ruiz', email: 'ana@correo.com' }, { conCuenta: false, idsAutorizados: new Set(), canal: 'portal', contactoPendiente: true })).toEqual({ ok: false, motivo: 'argumentos' })
  })

  it('la política pide los datos platicando, sin "formulario", y nombra al asesor y a quien recomendó', () => {
    const t = politica.tareaContacto(PEND)!
    expect(t).toMatch(/primero su nombre/); expect(t).toMatch(/celular y su correo/); expect(t).toMatch(/Roberto, su asesor/)
    expect(t).toMatch(/registrar_contacto/); expect(t).toMatch(/No digas "formulario"/); expect(t).toMatch(/Lourdes, cliente de Renovacell/)
    expect(politica.tareaContacto({ pendiente: false })).toBeNull()
  })

  it('con los tres datos la IA registra con lo que escribió la persona (servidor: conversación + su visitante) y agradece', async () => {
    const db = base({ registrado: true, nombre: 'Ana Ruiz', asesor_asignado: true })
    let sistema = ''
    const d = deps(db, [(s: SolicitudModelo) => { sistema = s.system; return respuestaHerramientas([{ name: 'registrar_contacto', input: { nombre: 'Ana Ruiz', telefono: '669 111 2233', email: 'ana@correo.com' } }]) },
      respuestaTexto('Gracias, Ana. Roberto ya tiene tu conversación y te dará seguimiento por aquí. ¿En qué te puedo ayudar mientras tanto?')])
    const r = await ejecutarTurno(entrada(PEND), d)
    expect(r.estado).toBe('respondio')
    expect(sistema).toMatch(/DATOS DE CONTACTO PENDIENTES/)
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_registrar_contacto')!.args).toEqual({ p_conv: CONV, p_hash: 'h'.repeat(64), p_nombre: 'Ana Ruiz', p_telefono: '669 111 2233', p_email: 'ana@correo.com', p_es_medico: false, p_cedula: null })
  })

  it('un dato inválido regresa como campo (para pedirlo de nuevo); sin datos pendientes la herramienta no existe aunque el modelo la pida', async () => {
    const db = base({ registrado: false, campo: 'telefono' })
    let resultado = ''
    const d = deps(db, [respuestaHerramientas([{ name: 'registrar_contacto', input: { nombre: 'Ana Ruiz', telefono: '12345', email: 'ana@correo.com' } }]),
      (s: SolicitudModelo) => { resultado = JSON.stringify(s.messages[s.messages.length - 1]); return respuestaTexto('Gracias, Ana. ¿Me compartes tu celular a 10 dígitos?') }])
    await ejecutarTurno(entrada(PEND), d)
    expect(resultado).toMatch(/registrado.*false/); expect(resultado).toMatch(/telefono/)

    const db2 = base({ registrado: true })
    let sistema2 = ''
    const d2 = deps(db2, [(s: SolicitudModelo) => { sistema2 = s.system; return respuestaHerramientas([{ name: 'registrar_contacto', input: { nombre: 'X Y', telefono: '6690000000', email: 'x@y.com' } }]) }, respuestaTexto('Claro, ¿en qué te ayudo?')])
    await ejecutarTurno(entrada(null), d2)
    expect(db2.llamadas.some((l) => l.fn === 'cc_ia_registrar_contacto')).toBe(false)
    expect(sistema2).not.toMatch(/DATOS DE CONTACTO PENDIENTES/)
  })
})
