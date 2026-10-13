// SEC-C4-B2 · servicio de búsqueda segura de clientes. Sin red y sin base: el transporte es inyectado.
import { describe, expect, it } from 'vitest'
import fuente from './buscarClientes.ts?raw'
import {
  BuscadorClientes, LIMITE_MAXIMO, LIMITE_POR_DEFECTO, leerClientes, limiteEfectivo, mensajeBusqueda, plegar, validarBusqueda,
  type RespuestaRpc, type TransporteBusqueda,
} from './buscarClientes'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fila = (n: number, extra: Record<string, unknown> = {}) => ({ customer_id: ID(n), nombre: `Cliente ${n}`, telefono_mascara: '••••' + String(1000 + n), ...extra })

interface Llamada { q: string; limite: number; signal?: AbortSignal }
function falso(responder: (ll: Llamada, i: number) => RespuestaRpc | Promise<RespuestaRpc>) {
  const llamadas: Llamada[] = []
  const transporte: TransporteBusqueda = async (args, signal) => { const ll = { ...args, signal }; llamadas.push(ll); return responder(ll, llamadas.length) }
  return { transporte, llamadas }
}
const ok = (n = 2): RespuestaRpc => ({ data: Array.from({ length: n }, (_, i) => fila(i + 1)), error: null, status: 200 })
const buscador = (t: TransporteBusqueda, o: { usuario?: () => string | null; ahora?: () => number; vida?: number } = {}) =>
  new BuscadorClientes({ transporte: t, identidad: o.usuario ?? (() => 'U-1'), ahora: o.ahora, vidaCacheMs: o.vida })

describe('C4-B2 · validación (espejo de la regla de la RPC)', () => {
  it('nombre válido: 3+ caracteres con alguna letra, hasta 60', () => {
    for (const q of ['mar', 'María José', 'ñan', 'Dra. López', '100% p', 'r_s', 'k\\s', 'a%a', 'Clínica 24', 'a1b', 'a'.repeat(60)]) {
      expect(validarBusqueda(q), q).toEqual({ ok: true, tipo: 'nombre', q })
    }
  })
  it('colapsa y recorta espacios (también tabuladores y saltos), sin tocar lo demás', () => {
    expect(validarBusqueda('  ÑANDÚ   ÁNGELES  ')).toEqual({ ok: true, tipo: 'nombre', q: 'ÑANDÚ ÁNGELES' })
    expect(validarBusqueda('\tmaria\n  jose\r')).toEqual({ ok: true, tipo: 'nombre', q: 'maria jose' })
    expect(validarBusqueda(' 0142 ')).toEqual({ ok: true, tipo: 'telefono', q: '0142' })
  })
  it('teléfono: EXACTAMENTE 4 dígitos', () => {
    expect(validarBusqueda('0001')).toEqual({ ok: true, tipo: 'telefono', q: '0001' })
    for (const q of ['1', '12', '123', '12345', '6671110001', '667 111', '00 01', '+52667', '(667) 111-0001']) expect(validarBusqueda(q), q).toEqual({ ok: false })
  })
  it('inválidas: vacía, corta, larga, sin letras, con @', () => {
    for (const q of ['', '   ', 'ab', 'a b', 'a  ', '%%%', '___', '100%', '...', 'a@x.test', '@', 'ana@', 'a'.repeat(61), 'a'.repeat(5000)]) expect(validarBusqueda(q), q.slice(0, 12)).toEqual({ ok: false })
  })
  it('la letra debe ser a-z tras quitar acentos (como en la base): otros alfabetos y símbolos no cuentan', () => {
    for (const q of ['Ωμέγα', 'Иван', '北京市', '😀😀😀', '١٢٣٤']) expect(validarBusqueda(q), q).toEqual({ ok: false })
    expect(validarBusqueda('garcía 😀')).toEqual({ ok: true, tipo: 'nombre', q: 'garcía 😀' })
    expect(validarBusqueda('Иван abc')).toEqual({ ok: true, tipo: 'nombre', q: 'Иван abc' })
  })
  it('cuenta caracteres, no unidades UTF-16: 60 emojis con una letra siguen siendo 60', () => {
    expect(validarBusqueda('a' + '😀'.repeat(59)).ok).toBe(true)
    expect(validarBusqueda('a' + '😀'.repeat(60)).ok).toBe(false)
  })
  it('los espacios Unicode cuentan como espacio, igual que en la base de producción (verificado contra ella)', () => {
    for (const e of [' ', ' ', ' ', '　', ' ', ' ', ' ', ' ', ' ', ' ', '\u0085', '\u001c', '\u001f']) {
      const cp = 'U+' + e.charCodeAt(0).toString(16)
      expect(validarBusqueda(`a${e}b`), cp).toEqual({ ok: false })                                        // queda "a b": 2 caracteres
      expect(validarBusqueda(`ab${e}`), cp).toEqual({ ok: false })                                        // queda "ab"
      expect(validarBusqueda(`${e}mar${e}${e}ia${e}`), cp).toEqual({ ok: true, tipo: 'nombre', q: 'mar ia' })   // se colapsa y se recorta
      expect(validarBusqueda(`${e}0142${e}`), cp).toEqual({ ok: true, tipo: 'telefono', q: '0142' })
    }
  })
  it('lo que NO es espacio para la base tampoco lo es aquí: ancho cero, marca de orden y BOM se conservan', () => {
    for (const c of ['​', '‮', '﻿', '‍']) expect(validarBusqueda(`a${c}b`)).toEqual({ ok: true, tipo: 'nombre', q: `a${c}b` })
  })
  it('la consulta que se envía ya va normalizada: solo espacios simples, sin extremos', async () => {
    const f = falso(() => ok()); await buscador(f.transporte).buscar('  María  José\t')
    expect(f.llamadas[0].q).toBe('María José')
  })
  it('valores inesperados: nunca lanza, siempre inválida', () => {
    for (const v of [null, undefined, 42, 1234, true, {}, [], ['mar'], () => 'mar', Symbol('x')]) expect(validarBusqueda(v as unknown)).toEqual({ ok: false })
  })
  it('plegar = minúsculas sin acentos, con las mismas tablas de la migración', () => {
    expect(plegar('ÑANDÚ Ángeles Çà Õ')).toBe('nandu angeles ca o')
    expect(plegar('Dermatología')).toBe('dermatologia')
  })
})

describe('C4-B2 · límite', () => {
  it('sin límite → 6; 1, 6 y 10 se respetan; por encima de 10 → 10; por debajo de 1 → 1', () => {
    expect(LIMITE_POR_DEFECTO).toBe(6); expect(LIMITE_MAXIMO).toBe(10)
    expect(limiteEfectivo()).toBe(6); expect(limiteEfectivo(1)).toBe(1); expect(limiteEfectivo(6)).toBe(6); expect(limiteEfectivo(10)).toBe(10)
    expect(limiteEfectivo(11)).toBe(10); expect(limiteEfectivo(1000)).toBe(10); expect(limiteEfectivo(0)).toBe(1); expect(limiteEfectivo(-5)).toBe(1)
  })
  it('límite inválido (no entero, NaN, infinito, texto, nulo) → 6', () => {
    for (const v of [2.5, NaN, Infinity, -Infinity, '10', null, {}, []]) expect(limiteEfectivo(v as unknown)).toBe(6)
  })
  it('lo que viaja al servidor es el límite ya acotado', async () => {
    const f = falso(() => ok()); const b = buscador(f.transporte, { vida: 0 })
    await b.buscar('maria'); await b.buscar('maria', { limite: 1 }); await b.buscar('maria', { limite: 10 }); await b.buscar('maria', { limite: 500 }); await b.buscar('maria', { limite: 2.5 })
    expect(f.llamadas.map((l) => l.limite)).toEqual([6, 1, 10, 10, 6])
  })
})

describe('C4-B2 · estados HTTP', () => {
  it('200 con resultados → ok con los tres campos', async () => {
    const r = await buscador(falso(() => ok(3)).transporte).buscar('maria')
    expect(r).toEqual({ estado: 'ok', desdeCache: false, clientes: [fila(1), fila(2), fila(3)] })
  })
  it('200 sin resultados → ok y lista vacía (no es un error)', async () => {
    expect(await buscador(falso(() => ({ data: [], error: null, status: 200 })).transporte).buscar('zzz')).toEqual({ estado: 'ok', clientes: [], desdeCache: false })
  })
  it('400, 401, 403, 429 y 500 → cada uno su estado; ninguno se disfraza de lista vacía', async () => {
    const casos: Array<[number, string]> = [[400, 'entrada_invalida'], [401, 'no_autenticado'], [403, 'sin_autorizacion'], [429, 'cuota_excedida'], [500, 'error_servidor'], [502, 'error_servidor'], [503, 'error_servidor']]
    for (const [status, estado] of casos) {
      // como lo entrega el cliente de Supabase ante un rechazo de la RPC: cuerpo `[]` convertido en `error`, sin datos
      const r = await buscador(falso(() => ({ data: null, error: [], status })).transporte).buscar('maria')
      expect(r, String(status)).toEqual({ estado })
      expect('clientes' in r).toBe(false)
    }
  })
  it('un rechazo con "datos" en el cuerpo sigue siendo rechazo: el estado manda, no el cuerpo', async () => {
    for (const status of [400, 401, 403, 429, 500]) {
      const r = await buscador(falso(() => ({ data: [fila(1)], error: null, status })).transporte).buscar('maria')
      expect(r.estado).not.toBe('ok')
    }
  })
  it('no se decide por el texto del error: mismo estado con cualquier mensaje', async () => {
    for (const error of [{ message: 'NO_AUTORIZADO' }, { message: 'todo bien, pasa' }, { message: '' }, 'texto', null]) {
      expect((await buscador(falso(() => ({ data: null, error, status: 403 })).transporte).buscar('maria')).estado).toBe('sin_autorizacion')
    }
  })
  it('estados inesperados (404, 405, 406, 409) → error_servidor', async () => {
    for (const status of [404, 405, 406, 409, 302]) expect((await buscador(falso(() => ({ data: null, error: {}, status })).transporte).buscar('maria')).estado).toBe('error_servidor')
  })
  it('fallo de red: estado 0 o promesa rechazada → error_red', async () => {
    expect((await buscador(falso(() => ({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 })).transporte).buscar('maria')).estado).toBe('error_red')
    expect((await buscador(falso(() => { throw new Error('sin red') }).transporte).buscar('maria')).estado).toBe('error_red')
    expect((await buscador(falso(() => ({ data: null, error: null })).transporte).buscar('maria')).estado).toBe('error_red')   // sin estado
  })
  it('cada estado no exitoso tiene su texto para la pantalla, distinto del de "sin resultados"', () => {
    const textos = (['entrada_invalida', 'no_autenticado', 'sin_autorizacion', 'cuota_excedida', 'error_red', 'error_servidor'] as const).map(mensajeBusqueda)
    expect(new Set(textos).size).toBe(6)
    expect(mensajeBusqueda('cuota_excedida')).toMatch(/límite/)
  })
})

describe('C4-B2 · privacidad', () => {
  it('propiedades ajenas al contrato se descartan: salen exactamente tres campos', async () => {
    const f = falso(() => ({ data: [fila(1, { phone: '6671110001', email: 'a@x.test', city: 'Culiacán', meta: { fiscal: { rfc: 'AAA010101AAA' } }, seller_name: 'odoo' })], error: null, status: 200 }))
    const r = await buscador(f.transporte).buscar('maria')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(Object.keys(r.clientes[0]).sort()).toEqual(['customer_id', 'nombre', 'telefono_mascara'])
    expect(JSON.stringify(r)).not.toMatch(/6671110001|@|Culiac|AAA010101|odoo/)
  })
  it('un teléfono que no venga enmascarado invalida TODA la respuesta (no se muestra a medias)', () => {
    for (const m of ['6671110001', '+52 667 111 0001', '••••00011', '••••000', '0001', '****0001', '', 667]) {
      expect(leerClientes([fila(1), fila(2, { telefono_mascara: m })]), String(m)).toBeNull()
    }
    expect(leerClientes([fila(1, { telefono_mascara: null })])).toEqual([{ customer_id: ID(1), nombre: 'Cliente 1', telefono_mascara: null }])
    expect(leerClientes([{ customer_id: ID(1), nombre: 'Sin campo' }])).toEqual([{ customer_id: ID(1), nombre: 'Sin campo', telefono_mascara: null }])
  })
  it('respuesta fuera de contrato → error_servidor: sin id válido, sin nombre, no es lista, o más de 10 filas', async () => {
    const malas: unknown[] = [{}, 'texto', 7, [null], ['x'], [fila(1, { customer_id: 'no-uuid' })], [fila(1, { customer_id: 5 })], [fila(1, { nombre: '' })], [fila(1, { nombre: null })], Array.from({ length: 11 }, (_, i) => fila(i + 1))]
    for (const data of malas) expect((await buscador(falso(() => ({ data, error: null, status: 200 })).transporte, { vida: 0 }).buscar('maria')).estado).toBe('error_servidor')
  })
  it('una respuesta fuera de contrato no se guarda en la caché', async () => {
    let n = 0; const f = falso(() => (++n === 1 ? { data: [fila(1, { telefono_mascara: '6671110001' })], error: null, status: 200 } : ok(1)))
    const b = buscador(f.transporte)
    expect((await b.buscar('maria')).estado).toBe('error_servidor')
    expect(await b.buscar('maria')).toMatchObject({ estado: 'ok', desdeCache: false })
  })
  it('el servicio solo conoce la RPC: su código no lee tablas, no usa llaves de servicio, no persiste ni registra', () => {
    const src = fuente.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(src).toContain("'buscar_clientes_pos'")
    expect(src.match(/\.rpc\b/g)?.length).toBe(1)
    expect(src).not.toMatch(/\.from\s*\(/)
    expect(src).not.toMatch(/customers|doctor_locations|cliente_360|service_role|SERVICE_KEY|createClient/)
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./)
    expect(src).not.toMatch(/user_id|p_user|seller_profile_id/)
  })
  it('al servidor solo viajan la consulta y el límite', async () => {
    const vistos: unknown[] = []
    const t: TransporteBusqueda = async (args) => { vistos.push(args); return ok() }
    await new BuscadorClientes({ transporte: t, identidad: () => 'U-9' }).buscar('  María  ', { limite: 3 })
    expect(vistos).toEqual([{ q: 'María', limite: 3 }])
  })
})

describe('C4-B2 · sin llamadas de más', () => {
  it('una entrada inválida no llega al servidor', async () => {
    const f = falso(() => ok()); const b = buscador(f.transporte)
    for (const q of ['', 'ab', '123', '12345', 'a@b.c', null, 7]) expect((await b.buscar(q)).estado).toBe('entrada_invalida')
    expect(f.llamadas).toHaveLength(0)
  })
  it('sin sesión no se llama: no_autenticado', async () => {
    const f = falso(() => ok())
    expect((await buscador(f.transporte, { usuario: () => null }).buscar('maria')).estado).toBe('no_autenticado')
    expect(f.llamadas).toHaveLength(0)
  })
  it('ningún reintento automático: un 429, un 400 o un 500 son UNA sola llamada', async () => {
    for (const status of [429, 400, 500, 0]) {
      const f = falso(() => ({ data: null, error: [], status })); await buscador(f.transporte).buscar('maria')
      expect(f.llamadas, String(status)).toHaveLength(1)
    }
  })
  it('un rechazo no se guarda: la siguiente búsqueda idéntica vuelve a preguntar', async () => {
    let n = 0; const f = falso(() => (++n === 1 ? { data: null, error: [], status: 429 } : ok()))
    const b = buscador(f.transporte)
    expect((await b.buscar('maria')).estado).toBe('cuota_excedida')
    expect((await b.buscar('maria')).estado).toBe('ok')
    expect(f.llamadas).toHaveLength(2)
  })
})

describe('C4-B2 · caché en memoria, por usuario', () => {
  it('repetir la misma búsqueda (sin importar mayúsculas, acentos o espacios) no vuelve a gastar cuota', async () => {
    const f = falso(() => ok(2)); const b = buscador(f.transporte)
    const a = await b.buscar('María  José')
    const c = await b.buscar('  maria jose ')
    expect(a).toMatchObject({ estado: 'ok', desdeCache: false }); expect(c).toMatchObject({ estado: 'ok', desdeCache: true })
    expect(c.estado === 'ok' && a.estado === 'ok' && c.clientes).toEqual(a.estado === 'ok' ? a.clientes : [])
    expect(f.llamadas).toHaveLength(1)
  })
  it('otro límite u otro tipo de búsqueda es otra entrada', async () => {
    const f = falso(() => ok(1)); const b = buscador(f.transporte)
    await b.buscar('maria'); await b.buscar('maria', { limite: 10 }); await b.buscar('1234'); await b.buscar('maria')
    expect(f.llamadas).toHaveLength(3)
  })
  it('caduca: pasado el tiempo de vida se vuelve a preguntar', async () => {
    let t = 1000; const f = falso(() => ok(1)); const b = buscador(f.transporte, { ahora: () => t, vida: 60_000 })
    await b.buscar('maria'); t += 59_999; expect((await b.buscar('maria'))).toMatchObject({ desdeCache: true })
    t += 2; expect((await b.buscar('maria'))).toMatchObject({ desdeCache: false })
    expect(f.llamadas).toHaveLength(2)
  })
  it('lo que se entrega es una copia: alterar el resultado no altera lo guardado', async () => {
    const b = buscador(falso(() => ok(1)).transporte)
    const a = await b.buscar('maria'); if (a.estado === 'ok') { a.clientes[0].nombre = 'ALTERADO'; a.clientes.push(fila(9)) }
    const c = await b.buscar('maria')
    expect(c.estado === 'ok' && c.clientes).toEqual([fila(1)])
  })
  it('está acotada: no crece sin límite', async () => {
    const f = falso(() => ok(1)); const b = new BuscadorClientes({ transporte: f.transporte, identidad: () => 'U-1', maxEntradasCache: 3 })
    for (const q of ['aaa', 'bbb', 'ccc', 'ddd']) await b.buscar(q)
    await b.buscar('ddd'); await b.buscar('ccc'); await b.buscar('bbb'); expect(f.llamadas).toHaveLength(4)   // siguen las 3 más recientes
    await b.buscar('aaa'); expect(f.llamadas).toHaveLength(5)                                                    // la más vieja salió
  })
  it('al cambiar de usuario no se entrega nada de la sesión anterior', async () => {
    let usuario: string | null = 'U-1'
    const f = falso((_ll, i) => ({ data: [fila(i)], error: null, status: 200 })); const b = buscador(f.transporte, { usuario: () => usuario })
    const a = await b.buscar('maria')
    usuario = 'U-2'
    const c = await b.buscar('maria')
    expect(c).toMatchObject({ estado: 'ok', desdeCache: false }); expect(f.llamadas).toHaveLength(2)
    expect(c.estado === 'ok' && a.estado === 'ok' && c.clientes[0].customer_id).not.toBe(a.estado === 'ok' ? a.clientes[0].customer_id : '')
    usuario = 'U-1'
    expect(await b.buscar('maria')).toMatchObject({ estado: 'ok', desdeCache: false })   // tampoco "vuelve" lo de antes
    expect(f.llamadas).toHaveLength(3)
  })
  it('al cerrar sesión: no_autenticado, y al volver a entrar se pregunta de nuevo', async () => {
    let usuario: string | null = 'U-1'; const f = falso(() => ok(1)); const b = buscador(f.transporte, { usuario: () => usuario })
    await b.buscar('maria'); usuario = null
    expect((await b.buscar('maria')).estado).toBe('no_autenticado')
    usuario = 'U-1'; b.limpiar()
    expect(await b.buscar('maria')).toMatchObject({ desdeCache: false })
  })
  it('dos buscadores no comparten nada', async () => {
    const f = falso(() => ok(1)); const b1 = buscador(f.transporte), b2 = buscador(f.transporte)
    await b1.buscar('maria'); expect(await b2.buscar('maria')).toMatchObject({ desdeCache: false })
  })
  it('con vida 0 no guarda nada', async () => {
    const f = falso(() => ok(1)); const b = buscador(f.transporte, { vida: 0 })
    await b.buscar('maria'); await b.buscar('maria'); expect(f.llamadas).toHaveLength(2)
  })
})

describe('C4-B2 · concurrencia y cancelación', () => {
  const diferido = () => { let soltar!: (r: RespuestaRpc) => void; const p = new Promise<RespuestaRpc>((res) => { soltar = res }); return { p, soltar } }
  it('dos búsquedas seguidas (la primera ya terminó): cada una su resultado', async () => {
    const f = falso((ll) => ({ data: [fila(ll.q === 'maria' ? 1 : 2)], error: null, status: 200 })); const b = buscador(f.transporte)
    const a = await b.buscar('maria'), c = await b.buscar('jose')
    expect(a.estado === 'ok' && a.clientes[0].customer_id).toBe(ID(1)); expect(c.estado === 'ok' && c.clientes[0].customer_id).toBe(ID(2))
  })
  it('la vieja termina DESPUÉS de la nueva: la vieja sale como cancelada y nunca pisa a la nueva', async () => {
    const d1 = diferido(), d2 = diferido()
    const f = falso((ll) => (ll.q === 'maria' ? d1.p : d2.p)); const b = buscador(f.transporte)
    const vieja = b.buscar('maria'), nueva = b.buscar('jose')
    expect(f.llamadas[0].signal?.aborted).toBe(true)        // al lanzar la nueva se avisó al navegador que suelte la vieja
    d2.soltar({ data: [fila(2)], error: null, status: 200 })
    expect(await nueva).toMatchObject({ estado: 'ok', clientes: [fila(2)] })
    d1.soltar({ data: [fila(1)], error: null, status: 200 })  // el transporte de prueba ignora la señal y aun así responde
    expect(await vieja).toEqual({ estado: 'cancelada' })
  })
  it('lo que llegó tarde ya se pagó: queda en caché para ese usuario y no se vuelve a pedir', async () => {
    const d1 = diferido(); const f = falso((ll) => (ll.q === 'maria' ? d1.p : ok(1))); const b = buscador(f.transporte)
    const vieja = b.buscar('maria'); await b.buscar('jose'); d1.soltar({ data: [fila(1)], error: null, status: 200 }); await vieja
    expect(await b.buscar('maria')).toMatchObject({ estado: 'ok', desdeCache: true }); expect(f.llamadas).toHaveLength(2)
  })
  it('cancelación por la pantalla (AbortSignal): cancelada, y la señal llega al transporte', async () => {
    const d = diferido(); const f = falso(() => d.p); const b = buscador(f.transporte); const ac = new AbortController()
    const p = b.buscar('maria', { signal: ac.signal }); ac.abort()
    expect(f.llamadas[0].signal?.aborted).toBe(true)
    d.soltar({ data: null, error: { message: 'AbortError: The user aborted a request.' }, status: 0 })   // así responde el cliente real
    expect(await p).toEqual({ estado: 'cancelada' })
  })
  it('una señal ya cancelada no llega a llamar', async () => {
    const f = falso(() => ok()); const ac = new AbortController(); ac.abort()
    expect(await buscador(f.transporte).buscar('maria', { signal: ac.signal })).toEqual({ estado: 'cancelada' }); expect(f.llamadas).toHaveLength(0)
  })
  it('cancelar() o limpiar() descartan la búsqueda en curso', async () => {
    for (const metodo of ['cancelar', 'limpiar'] as const) {
      const d = diferido(); const b = buscador(falso(() => d.p).transporte); const p = b.buscar('maria'); b[metodo]()
      d.soltar(ok(1)); expect(await p).toEqual({ estado: 'cancelada' })
    }
  })
  it('un fallo real de red NO se confunde con cancelación', async () => {
    expect(await buscador(falso(() => ({ data: null, error: { message: 'AbortError' }, status: 0 })).transporte).buscar('maria')).toEqual({ estado: 'error_red' })
  })
  it('si la sesión cambia mientras se espera, el resultado no se entrega ni se guarda', async () => {
    let usuario: string | null = 'U-1'; const d = diferido(); let n = 0
    const f = falso(() => (++n === 1 ? d.p : ok(1))); const b = buscador(f.transporte, { usuario: () => usuario })
    const p = b.buscar('maria'); usuario = 'U-2'; d.soltar({ data: [fila(7)], error: null, status: 200 })
    expect(await p).toEqual({ estado: 'cancelada' })
    const r = await b.buscar('maria')
    expect(r).toMatchObject({ estado: 'ok', desdeCache: false }); expect(r.estado === 'ok' && r.clientes[0].customer_id).toBe(ID(1))
  })
})
