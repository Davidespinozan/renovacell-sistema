// @vitest-environment jsdom
// CX-ENLACE · enlace único de contacto con prerregistro: forma del prerregistro (servidor y cliente), puertas,
// y las piezas de despliegue que lo hacen UN solo origen (regla de Netlify, redirección por host, prellenado).
import { describe, it, expect, vi } from 'vitest'
import { limpiarPrerregistro, mapearErrorPrerregistro } from '../../../../../supabase/functions/_shared/visitante'
import { esSesionDeUsuario } from '../../../../../supabase/functions/_shared/quien'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import { LIMITES } from '../../../../../supabase/functions/_shared/limite'
import { abrirVisitante, estadoVisitante, prerregistrar, validarPrerregistro, LLAVE_PRELLENADO, LLAVE_VISITANTE } from './visitante'
import { contactoDe, urlEnlaceContacto, urlVerificacionMedica } from './contactoEnlace'
import mig from '../../../../../supabase/migrations/20261203120000_cx_enlace_prerregistro.sql?raw'
import netlify from '../../../../../netlify.toml?raw'
import router from '../../../../../netlify/edge-functions/host-router.ts?raw'
import landing from '../../../public/landing/index.html?raw'
import appSrc from '../../App.tsx?raw'
import contactoHtml from '../../../contacto.html?raw'
import viteCfg from '../../../vite.config.ts?raw'

const TOKEN = 'A'.repeat(43)
const almacen = (inicial: Record<string, string> = {}) => { const m = new Map(Object.entries(inicial)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m } }
const BUENO = { nombre: ' Ana   Ruiz ', telefono: '+52 (669) 000-0001', email: ' ANA@Test.Local ', es_medico: true, cedula: '1234567', consent: true }

describe('CX-ENLACE · forma del prerregistro en el servidor', () => {
  it('normaliza: espacios, celular a 10 dígitos (con o sin 52), correo en minúsculas', () => {
    expect(limpiarPrerregistro(BUENO)).toEqual({ ok: true, datos: { nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: true, cedula: '1234567', consent: true } })
    const r = limpiarPrerregistro({ ...BUENO, telefono: '5216690000001', cedula: '' }); expect(r.ok && r.datos.telefono).toBe('6690000001'); expect(r.ok && r.datos.cedula).toBeNull()
  })
  it('rechaza por campo, y sin consentimiento expreso no pasa', () => {
    const campo = (x: unknown) => { const r = limpiarPrerregistro(x); return r.ok ? null : r.campo }
    expect(campo({ ...BUENO, nombre: 'An' })).toBe('nombre'); expect(campo({ ...BUENO, telefono: '12345' })).toBe('telefono')
    expect(campo({ ...BUENO, email: 'ana@' })).toBe('email'); expect(campo({ ...BUENO, cedula: '12' })).toBe('cedula')
    expect(campo({ ...BUENO, consent: 'true' })).toBe('consentimiento'); expect(campo(null)).toBe('nombre'); expect(campo([BUENO])).toBe('nombre')
  })
  it('errores de la base → mensajes para la persona, sin detalles internos', () => {
    expect(mapearErrorPrerregistro('PRERREGISTRO_INVALIDO: telefono')).toMatchObject({ status: 400, body: { campo: 'telefono' } })
    expect(mapearErrorPrerregistro('SESION_INVALIDA').body.error).toBe('sesion_invalida')
    const d = mapearErrorPrerregistro('duplicate key value violates unique constraint "x"'); expect(d.status).toBe(503); expect(d.body.message).not.toMatch(/duplicate|constraint/)
  })
  it('el prerregistro y la consulta de estado tienen su propio límite', () => {
    expect(LIMITES.visitor_prerregistro.limite).toBeLessThanOrEqual(10); expect(LIMITES.visitor_prerregistro_global).toBeTruthy(); expect(LIMITES.visitor_estado).toBeTruthy()
  })
})

describe('CX-ENLACE · el visitante anónimo no se confunde con una sesión', () => {
  const jwt = (carga: Record<string, unknown>) => `h.${btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.f`
  it('la llave pública del sitio (JWT anon o sb_publishable) NO es una sesión; un token de usuario sí', () => {
    expect(esSesionDeUsuario('Bearer ' + jwt({ role: 'anon', iss: 'supabase' }))).toBe(false)
    expect(esSesionDeUsuario('Bearer sb_publishable_abc123')).toBe(false)
    expect(esSesionDeUsuario('')).toBe(false); expect(esSesionDeUsuario(null)).toBe(false); expect(esSesionDeUsuario('Bearer a.b.c')).toBe(false)
    expect(esSesionDeUsuario('Bearer ' + jwt({ role: 'service_role' }))).toBe(false)
    expect(esSesionDeUsuario('Bearer ' + jwt({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' }))).toBe(true)
    expect(esSesionDeUsuario('bearer ' + jwt({ sub: 'ñandú-ü', role: 'authenticated' }))).toBe(true)
  })
  it('el visitante del enlace entra a la cola humana con su primer mensaje, antes de que responda el asistente y sin bloquear el envío', () => {
    const iEnvio = chatEdge.indexOf("admin.rpc('cc_enviar_mensaje'"); const iAuto = chatEdge.indexOf("admin.rpc('cc_enlace_auto_asesor'"); const iIA = chatEdge.indexOf('await responderIA(admin')
    expect(iEnvio).toBeGreaterThan(0); expect(iAuto).toBeGreaterThan(iEnvio); expect(iIA).toBeGreaterThan(iAuto)
    expect(chatEdge).toMatch(/if \(!r\.idempotente && actor\.actor === 'visitor' && \(r\.modo === 'ai_active' \|\| r\.modo === 'human_offered'\)\) \{\s*\n\s*await admin\.rpc\('cc_enlace_auto_asesor', \{ p_conv: conv, p_visitor_hash: hash \}\)\.then\(\(\) => \{\}, \(\) => \{\}\)/)
  })
  it('la función chat clasifica por el contenido del token, no comparando contra la llave del entorno', () => {
    expect(chatEdge).toMatch(/if \(esSesionDeUsuario\(authHeader\)\) \{/); expect(chatEdge).not.toMatch(/!== anon\)/)
  })
})

describe('CX-ENLACE · cliente', () => {
  it('valida antes de enviar', () => {
    const d = { nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: false, cedula: '' }
    expect(validarPrerregistro(d, true)).toBeNull()
    expect(validarPrerregistro({ ...d, telefono: '669' }, true)?.campo).toBe('telefono')
    expect(validarPrerregistro(d, false)?.campo).toBe('consentimiento')
    expect(validarPrerregistro({ ...d, cedula: '12' }, true)).toBeNull()   // sin marcar "profesional de la salud" la cédula no cuenta
  })
  it('dos aperturas simultáneas (arranque de la app + página de contacto) crean UN solo visitante', async () => {
    const st = almacen(); let suelta: (v: unknown) => void = () => {}
    const invocar = vi.fn(() => new Promise<{ data: unknown; error: unknown }>((r) => { suelta = r as (v: unknown) => void }))
    const a = abrirVisitante({ invocar, st }); const b = abrirVisitante({ invocar, st })
    await Promise.resolve(); suelta({ data: { nuevo: true, token: TOKEN }, error: null })
    expect(await Promise.all([a, b])).toEqual(['nuevo', 'nuevo']); expect(invocar).toHaveBeenCalledTimes(1); expect(st.m.get(LLAVE_VISITANTE)).toBe(TOKEN)
    await Promise.resolve()
    invocar.mockResolvedValueOnce({ data: { nuevo: false }, error: null })
    expect(await abrirVisitante({ invocar, st })).toBe('reanudado'); expect(invocar).toHaveBeenCalledTimes(2)   // ya terminada, la siguiente sí pregunta
  })
  it('estado: sin token no pregunta; con token devuelve lo que diga el servidor; ante un fallo pide el formulario', async () => {
    const invocar = vi.fn().mockResolvedValue({ data: { visitante: true, prerregistrado: true, nombre: 'Ana Ruiz' }, error: null })
    expect(await estadoVisitante({ invocar, st: almacen() })).toEqual({ visitante: false, prerregistrado: false, nombre: null }); expect(invocar).not.toHaveBeenCalled()
    expect(await estadoVisitante({ invocar, st: almacen({ [LLAVE_VISITANTE]: TOKEN }) })).toEqual({ visitante: true, prerregistrado: true, nombre: 'Ana Ruiz' })
    expect(invocar).toHaveBeenCalledWith('visitor', { body: { action: 'estado', token: TOKEN } })
    expect((await estadoVisitante({ invocar: async () => { throw new Error('x') }, st: almacen({ [LLAVE_VISITANTE]: TOKEN }) })).prerregistrado).toBe(false)
  })
  it('prerregistrar: manda los datos normalizados con el token, y deja el prellenado para la verificación', async () => {
    const st = almacen({ [LLAVE_VISITANTE]: TOKEN })
    const invocar = vi.fn().mockResolvedValue({ data: { estado: 'registrado', nombre: 'Ana Ruiz' }, error: null })
    const r = await prerregistrar({ nombre: ' Ana Ruiz ', telefono: '669 000 0001', email: 'ANA@test.local', es_medico: false, cedula: '999999' }, { invocar, st })
    expect(r).toEqual({ ok: true, nombre: 'Ana Ruiz' })
    expect(invocar).toHaveBeenCalledWith('visitor', { body: { action: 'prerregistrar', token: TOKEN, datos: { nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: false, cedula: '', consent: true } } })
    expect(JSON.parse(st.m.get(LLAVE_PRELLENADO)!)).toEqual({ nombre: 'Ana Ruiz', telefono: '6690000001', correo: 'ana@test.local', cedula: '' })
  })
  it('prerregistrar: sin sesión de visitante abre una primero; un rechazo del servidor llega con su campo', async () => {
    const st = almacen()
    const invocar = vi.fn(async (_fn: string, o: { body: Record<string, unknown> }) => o.body.action === 'abrir'
      ? { data: { nuevo: true, token: TOKEN }, error: null }
      : { data: null, error: { context: new Response(JSON.stringify({ error: 'prerregistro_invalido', message: 'Escribe tu celular a 10 dígitos.', campo: 'telefono' })) } })
    const r = await prerregistrar({ nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: false, cedula: '' }, { invocar, st })
    expect(invocar.mock.calls.map((c) => c[1].body.action)).toEqual(['abrir', 'prerregistrar'])
    expect(r).toEqual({ ok: false, mensaje: 'Escribe tu celular a 10 dígitos.', campo: 'telefono' })
    expect(st.m.has(LLAVE_PRELLENADO)).toBe(false)
  })
  it('el enlace que se comparte es UNO: el del dominio público en producción', () => {
    expect(urlEnlaceContacto({ hostname: 'sistema.renovacell.mx', origin: 'https://sistema.renovacell.mx' })).toBe('https://renovacell.mx/contacto')
    expect(urlEnlaceContacto({ hostname: 'renovacell.mx', origin: 'https://renovacell.mx' })).toBe('https://renovacell.mx/contacto')
    expect(urlEnlaceContacto({ hostname: 'localhost', origin: 'http://localhost:5173' })).toBe('http://localhost:5173/contacto')
    expect(urlEnlaceContacto({ hostname: 'malrenovacell.mx', origin: 'https://malrenovacell.mx' })).toBe('https://malrenovacell.mx/contacto')
  })
  it('el registro de doctores también es uno: el de la landing, en el dominio público', () => {
    expect(urlVerificacionMedica({ hostname: 'sistema.renovacell.mx', origin: 'https://sistema.renovacell.mx' })).toBe('https://renovacell.mx/#contacto')
    expect(urlVerificacionMedica({ hostname: 'localhost', origin: 'http://localhost:5173' })).toBe('http://localhost:5173/#contacto')
  })
  it('contacto de una conversación: lee el comando y nunca lanza', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: true, cedula: null, posible_cliente: 'Dra. Cartera', confirmado: false }, error: null })
    expect(await contactoDe('C-1', rpc)).toEqual({ nombre: 'Ana Ruiz', telefono: '6690000001', email: 'ana@test.local', es_medico: true, cedula: null, posible_cliente: 'Dra. Cartera', posible_cliente_id: null, confirmado: false })
    expect(rpc).toHaveBeenCalledWith('cc_contacto_de', { p_conv: 'C-1' })
    expect(await contactoDe('C-1', async () => ({ data: null, error: { message: 'NO_AUTORIZADO' } }))).toBeNull()
    expect(await contactoDe('C-1', async () => { throw new Error('red') })).toBeNull()
  })
})

describe('CX-ENLACE · guardas de seguridad y despliegue', () => {
  const sql = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  it('la tabla no tiene políticas y los comandos sensibles son solo del servidor', () => {
    expect(sql).toMatch(/alter table public\.cc_prerregistros enable row level security/)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toMatch(/revoke all on table public\.cc_prerregistros from public, anon, authenticated/)
    for (const f of ['cc_visitante_prerregistrar(text, text, text, text, boolean, text, boolean)', 'cc_puerta_chat(text, uuid)', '_cc_prerregistro_coincidencia(text, text)']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated`); expect(sql).toContain(`grant execute on function public.${f} to service_role`)
    }
    expect(sql).toContain('grant execute on function public.cc_contacto_de(uuid) to authenticated, service_role')
  })
  it('la coincidencia solo rutea: el prerregistro no adopta, no toca la cartera y no cambia después', () => {
    const cuerpo = sql.slice(sql.indexOf('create function public.cc_visitante_prerregistrar'), sql.indexOf('create function public.cc_puerta_chat'))
    expect(cuerpo).not.toMatch(/adopted_profile_id|pending_profile_id|cc_cartera\b|update public\.cc_conversations/)
    expect(cuerpo).toMatch(/if found then[\s\S]{0,200}'ya_registrado'/)
    expect(sql).toMatch(/case when cardinality\(v_cust\) = 1 then v_cust\[1\] end/); expect(sql).toMatch(/case when cardinality\(v_sell\) = 1 then v_sell\[1\] end/)
  })
  it('la página es pública y va antes de login y roles; Netlify la sirve y las puertas del sistema la mandan al dominio público', () => {
    expect(appSrc).toMatch(/else if \(esRutaContacto\) view = <Contacto \/>\s*\n\s*else if \(esRutaInvitacion\) view = <Invitacion \/>\s*\n\s*else if \(mode === 'landing'\)/)
    expect(netlify).toMatch(/from = "\/contacto"\s*\n\s*to = "\/contacto\.html"\s*\n\s*status = 200/)
    expect(netlify.indexOf('from = "/contacto"')).toBeLessThan(netlify.indexOf('from = "/*"'))
    expect(router).toMatch(/APP_DOORS\.has\(host\) && \/\^\\\/contacto\(\\\/\|\$\)\/\.test\(url\.pathname\)/); expect(router).toMatch(/https:\/\/renovacell\.mx\$\{url\.pathname\}\$\{url\.search\}`, 302/)
  })
  it('al compartir el enlace se ve la marca del negocio, nunca "Sistema operativo"', () => {
    expect(contactoHtml).not.toMatch(/sistema operativo/i); expect(contactoHtml).not.toMatch(/manifest\.webmanifest/)
    expect(contactoHtml).toMatch(/<title>Renovacell · Tecnologías Antiedad<\/title>/)
    expect(contactoHtml).toMatch(/property="og:title" content="Renovacell · Tecnologías Antiedad"/); expect(contactoHtml).toMatch(/property="og:description" content="Chatea con un asesor\."/); expect(contactoHtml).toMatch(/property="og:image" content="https:\/\/renovacell\.mx\/brand\/app-apple-180-v2\.png"/)
    expect(contactoHtml).toMatch(/og:image:width" content="180"/); expect(contactoHtml).not.toMatch(/summary_large_image|og-renovacell/)   // miniatura, no foto grande
    expect(contactoHtml).toMatch(/src="\/src\/main\.tsx"/)                       // la misma aplicación
    expect(viteCfg).toMatch(/input: \{ main: 'index\.html', contacto: 'contacto\.html', invitacion: 'invitacion\.html' \}/)
  })
  it('la landing reutiliza el prerregistro en su formulario y sigue sin ofrecer chat humano', () => {
    expect(landing).toMatch(/localStorage\.getItem\('rc_prefill'\)/)
    expect(landing).not.toMatch(/href="\/contacto"|href="\/chat"/)
  })
})
