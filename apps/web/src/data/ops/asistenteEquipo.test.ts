// ASISTENTE DEL EQUIPO · bucle con proveedor FALSO (nunca la API real): herramientas con la base del usuario, errores de
// permiso en palabras, historial seguro, prompt fijo en caché y manual que solo nombra pantallas que existen.
import { describe, it, expect, vi } from 'vitest'
import { ejecutarAsistente, historialValido, llamadaDe, errorHerramienta, SYSTEM_EQUIPO, HERRAMIENTAS_EQUIPO, contextoTurno } from '../../../../../supabase/functions/_shared/ia/asistenteEquipo'
import { MANUAL_SISTEMA } from '../../../../../supabase/functions/_shared/ia/manualSistema'
import { crearProveedorFalso, cuerpoAnthropic, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import roles from '../../app/roles.ts?raw'
import edge from '../../../../../supabase/functions/asistente-equipo/index.ts?raw'
import { LIMITES } from '../../../../../supabase/functions/_shared/limite'

const AHORA = new Date('2026-11-06T21:03:00Z')
const base = { historial: [], quien: { nombre: 'Claudia', rol: 'admin' }, ahora: AHORA }

describe('bucle del asistente', () => {
  it('conversaciones → la base del usuario → respuesta; el contexto lleva quién pregunta y la fecha de Culiacán', async () => {
    const prov = crearProveedorFalso([respuestaHerramientas([{ name: 'conversaciones', input: { texto: 'Maria Jose Vea' } }]), respuestaTexto('Le tocó a **Alejandra** por reparto.')])
    const rpc = vi.fn(async () => ({ data: [{ contacto: 'Dra. Maria Jose Vea C.', atiende_ahora: 'Alejandra Cázarez' }], error: null }))
    const r = await ejecutarAsistente({ ...base, pregunta: '¿Por qué la Dra. Vea le tocó a Alejandra?' }, { proveedor: prov, rpc })
    expect(r).toMatchObject({ ok: true, texto: 'Le tocó a **Alejandra** por reparto.' })
    expect(rpc).toHaveBeenCalledWith('ia_eq_conversaciones', { p_texto: 'Maria Jose Vea', p_limite: 3 })
    expect(r.herramientas).toEqual([expect.objectContaining({ nombre: 'conversaciones', ok: true })])
    const primera = prov.solicitudes[0]
    expect(String(primera.messages[0].content)).toMatch(/<contexto>Pregunta: Claudia \(Dirección\)\. Hoy: viernes, 6 de noviembre de 2026.*14:03/)
    expect(primera.systemFijo).toBe(SYSTEM_EQUIPO.length)
    // el resultado vuelve como tool_result en UN mensaje de la persona
    const seg = prov.solicitudes[1].messages[prov.solicitudes[1].messages.length - 1].content as Array<{ type: string; content: string }>
    expect(seg[0].type).toBe('tool_result'); expect(seg[0].content).toMatch(/Alejandra Cázarez/)
  })
  it('sin permiso: el modelo recibe SIN_PERMISO (no el error crudo) y la consulta queda marcada', async () => {
    const prov = crearProveedorFalso([respuestaHerramientas([{ name: 'pedido', input: { folio: 'S12' } }]), respuestaTexto('Eso no lo puedes ver con tu usuario.')])
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'NO_AUTORIZADO: ese pedido no es de tu cartera' } }))
    const r = await ejecutarAsistente({ ...base, quien: { nombre: 'Ale', rol: 'pos' }, pregunta: '¿Cómo va el S12?' }, { proveedor: prov, rpc })
    const res = (prov.solicitudes[1].messages[prov.solicitudes[1].messages.length - 1].content as unknown as Array<{ content: string; is_error?: boolean }>)[0]
    expect(res).toMatchObject({ is_error: true }); expect(res.content).toMatch(/^SIN_PERMISO/)
    expect(r.herramientas[0].ok).toBe(false)
  })
  it('entrada inválida no llega a la base; herramienta desconocida tampoco', async () => {
    const prov = crearProveedorFalso([respuestaHerramientas([{ name: 'ficha_cliente', input: { customer_id: 'drop table' } }, { name: 'borrar_todo', input: {} }]), respuestaTexto('ok')])
    const rpc = vi.fn()
    await ejecutarAsistente({ ...base, pregunta: 'x' }, { proveedor: prov, rpc })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('error del proveedor o demasiadas rondas → mensaje honesto, sin inventar', async () => {
    const err = await ejecutarAsistente({ ...base, pregunta: 'x' }, { proveedor: crearProveedorFalso([{ tipo: 'error', clase: 'provider_timeout', usage: { input: 0, output: 0 }, ambiguo: true }]), rpc: vi.fn() })
    expect(err).toMatchObject({ ok: false, error: 'provider_timeout' })
    const bucle = await ejecutarAsistente({ ...base, pregunta: 'x' }, { proveedor: crearProveedorFalso([respuestaHerramientas([{ name: 'pedido', input: { folio: 'S1' } }])]), rpc: vi.fn(async () => ({ data: {}, error: null })) })
    expect(bucle).toMatchObject({ ok: false, error: 'rondas' })
  })
})

describe('piezas', () => {
  it('historial: solo texto, empieza con la persona, alterna y no deja la última pregunta colgada', () => {
    expect(historialValido([{ rol: 'asistente', texto: 'hola' }, { rol: 'persona', texto: 'a' }, { rol: 'persona', texto: 'b' }, { rol: 'asistente', texto: 'c' }, { rol: 'sistema', texto: 'x' }, { rol: 'persona', texto: 'd' }]))
      .toEqual([{ rol: 'persona', texto: 'a' }, { rol: 'asistente', texto: 'c' }])
    expect(historialValido('basura')).toEqual([])
  })
  it('llamadas: cada herramienta a su función con permisos de la base', () => {
    expect(llamadaDe('buscar_cliente', { texto: 'Vea' })).toEqual({ fn: 'buscar_clientes_pos', args: { q: 'Vea', limite: 8 } })
    expect(llamadaDe('ficha_cliente', { customer_id: '80902675-84a1-4c5e-993a-11074cfab684' })).toEqual({ fn: 'cliente_360', args: { p_customer: '80902675-84a1-4c5e-993a-11074cfab684' } })
    expect(llamadaDe('pedido', { folio: ' S1234 ' })).toEqual({ fn: 'ia_eq_pedido', args: { p_folio: 'S1234' } })
    expect(HERRAMIENTAS_EQUIPO.map((h) => h.name)).toEqual(['buscar_cliente', 'ficha_cliente', 'conversaciones', 'pedido'])
  })
  it('errores en palabras', () => {
    expect(errorHerramienta('permission denied for function x')).toMatch(/^SIN_PERMISO/)
    expect(errorHerramienta('algo raro')).toMatch(/^ERROR/)
  })
  it('caché: todo el system fijo en un solo bloque; el canal sigue partiéndolo', () => {
    const s = { system: SYSTEM_EQUIPO, systemFijo: SYSTEM_EQUIPO.length, messages: [], tools: HERRAMIENTAS_EQUIPO, max_tokens: 100, timeoutMs: 1 }
    expect(cuerpoAnthropic('claude-opus-5-5', s).body.system).toEqual([{ type: 'text', text: SYSTEM_EQUIPO, cache_control: { type: 'ephemeral' } }])
    expect((cuerpoAnthropic('claude-opus-5-5', { ...s, system: 'fijo|variable', systemFijo: 5 }).body.system as unknown[]).length).toBe(2)
    expect(contextoTurno({ ...base, pregunta: '' })).not.toMatch(SYSTEM_EQUIPO.slice(0, 20))   // lo variable va en el mensaje, no en el system
  })
  it('el manual solo nombra pantallas que existen en el menú (o botones del chat)', () => {
    const BOTONES = ['Iniciar', 'Vincular a un cliente', 'Verificar y dar de alta', 'Mandar acceso al portal', 'Cotizar', 'Levantar pedido', 'Registrar pago', 'Mandar recibo', 'Ver su ficha',
      'Pasar a otro vendedor', 'Mandar ubicación', 'Dejar seguimiento', 'Eliminar conversación', '/', '+', 'Parece un bot', 'Aviso para el asistente', 'Regla de entrega', 'Configuración', 'Atender conversaciones',
      'Conversaciones', 'Asesora IA']
    const nombres = [...MANUAL_SISTEMA.matchAll(/«([^»]+)»/g)].map((m) => m[1])
    expect(nombres.length).toBeGreaterThan(40)
    const faltan = nombres.filter((n) => !BOTONES.includes(n) && !roles.includes(`'${n}'`))
    expect(faltan).toEqual([])
  })
  it('Edge: solo personal con sesión, límites antes del modelo, bitácora y 501 sin llave', () => {
    expect(edge).toMatch(/if \(!key\) return json\(501/)
    expect(edge).toMatch(/ROLES = new Set\(\['admin', 'pos', 'warehouse', 'packing', 'driver'\]\)/)
    expect(edge.indexOf("limitarTodas(admin, [{ scope: 'ia_equipo_hora'")).toBeLessThan(edge.indexOf('ejecutarAsistente('))
    expect(edge).toMatch(/rpc: \(fn, args\) => caller\.rpc\(fn, args\)/)   // con el JWT de quien pregunta, nunca service_role
    expect(edge).toMatch(/from\('ia_eq_consultas'\)\.insert/)
    expect(LIMITES.ia_equipo_hora).toEqual({ limite: 40, ventanaSegs: 3600 })
  })
})
