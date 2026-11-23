// IA · TANDA 2 (23 nov 2026) · regresiones sacadas de las 34 conversaciones reales (parte A / parte B, «C<n> seq<m>»).
// Proveedor de IA FALSO y base FALSA: sin Anthropic, sin red, sin Meta. Cubre:
//   3 · «sí manejamos» solo con evidencia (con existencia / sin existencia → alternativa / no aparece → no se afirma);
//       búsqueda tolerante a errores de dedo y presentaciones (SQL: guardas sobre la migración; probado en prod con rollback)
//   7 · dirección de la sucursal (nunca la fiscal), sin motivos inventados, sin costo de envío que contradiga la cotización
//   8 · imágenes (sí las ve), audios (una línea, una vez), bots, terceros, enfermería, pacientes, revendedores
//   9 · trato: «doctora/doctor» y nombre solo si se sabe; nunca «doctor(a)»; enlaces solo del dominio de la app
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import * as conversacion from '../../../../../supabase/functions/_shared/ia/conversacion'
import { frenoBot, esClaramenteAutomatico } from '../../../../../supabase/functions/_shared/ia/antibot'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { dependenciasCanal } from '../../../../../supabase/functions/_shared/ia/responder'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'
import { enlaceCrearContrasena, esEnlaceDeLaApp } from '../../../../../supabase/functions/_shared/enlaceApp'
import { tokenRecuperacion } from '../../auth/enlaceRecuperacion'
import { SUCURSAL } from '../../../../../supabase/functions/_shared/ubicacion'

const raiz = resolve(__dirname, '../../../../..')
const migracion = readFileSync(resolve(raiz, 'supabase/migrations/20270407480000_ia_tanda2.sql'), 'utf8')
const sql = migracion.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
const responderSrc = readFileSync(resolve(raiz, 'supabase/functions/_shared/ia/responder.ts'), 'utf8')
const altaSrc = readFileSync(resolve(raiz, 'supabase/functions/alta-whatsapp/index.ts'), 'utf8')
const roleSrc = readFileSync(resolve(raiz, 'apps/web/src/auth/RoleContext.tsx'), 'utf8')
const examenSrc = readFileSync(resolve(raiz, 'supabase/functions/_shared/ia/examen.ts'), 'utf8')

const CONV = '99999999-9999-4999-8999-999999999999'
const I100 = '11111111-1111-4111-8111-111111111111', BOTOX = '44444444-4444-4444-8444-444444444444', N100 = '22222222-2222-4222-8222-222222222222', N200 = '33333333-3333-4333-8333-333333333333'
const CATALOGO = [{ product_id: BOTOX, nombre: 'Botox 100 UI' }, { product_id: '55555555-5555-4555-8555-555555555555', nombre: 'Dysport 500 UI' }, { product_id: '66666666-6666-4666-8666-666666666666', nombre: 'Xeomeen 100 UI' }]
const validacionCanal = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanal = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }
type H = { actor: string; content: string; seq?: number }

// Salidas con la forma REAL de cc_ia_producto_estado (consultada en prod con rollback el 23 nov 2026)
const EST_INNOTOX = { consulta: 'innotox 100 ui', coincidencia: 'exacta', presentacion_pedida: '100 UI', presentacion_no_manejada: false,
  pedidos: [{ nombre: 'INNOTOX 100 UI', se_vende: true, disponible_ahora: false, solo_para_profesionales: true }],
  presentaciones_que_manejamos: [{ nombre: 'INNOTOX 50 UI', disponible_ahora: false }, { nombre: 'INNOTOX 100 UI', disponible_ahora: false }],
  alternativas: [{ motivo: 'misma_presentacion', nombre: 'Botox 100 UI', product_id: BOTOX }, { motivo: 'misma_presentacion', nombre: 'NABOTA 100 UI', solo_para_profesionales: true }] }
const EST_NABOTA150 = { consulta: 'nabota 150 ui', coincidencia: 'exacta', presentacion_pedida: '150 UI', presentacion_no_manejada: true, pedidos: [],
  presentaciones_que_manejamos: [{ nombre: 'NABOTA 100 UI', disponible_ahora: true }, { nombre: 'NABOTA 200 UI', disponible_ahora: true }],
  alternativas: [{ motivo: 'misma_marca', nombre: 'NABOTA 100 UI', solo_para_profesionales: true }, { motivo: 'misma_marca', nombre: 'NABOTA 200 UI', solo_para_profesionales: true }] }
const EST_NABOTA200_AGOTADO = { consulta: 'nabota 200 ui', coincidencia: 'exacta', presentacion_pedida: '200 UI', presentacion_no_manejada: false,
  pedidos: [{ nombre: 'NABOTA 200 UI', se_vende: true, disponible_ahora: false, solo_para_profesionales: true }],
  alternativas: [{ motivo: 'misma_marca', nombre: 'NABOTA 100 UI', solo_para_profesionales: true }, { motivo: 'misma_presentacion', nombre: 'Wondertox 200 UI', solo_para_profesionales: true }] }
const EST_HYALUX = { consulta: 'hyalux deep', coincidencia: 'ninguna' }
const EST_LINURASE = { consulta: 'linurase', coincidencia: 'exacta', presentacion_pedida: null, presentacion_no_manejada: false,
  pedidos: [{ nombre: 'Linurase 100 UI', se_vende: true, disponible_ahora: true, solo_para_profesionales: true }], presentaciones_que_manejamos: [{ nombre: 'Linurase 100 UI', disponible_ahora: true }] }

function base(o: { buscar?: (q: string, aud: string) => unknown[]; estado?: (q: string) => unknown; handoff?: Record<string, unknown> } = {}) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_identidad_canal': return { data: null, error: null }
      case 'cc_ia_media_caja': return { data: [], error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active', ...(o.handoff ?? {}) }, error: null }
      case 'cc_catalogo_para_ia': return { data: CATALOGO, error: null }
      case 'cc_buscar_productos': return { data: (o.buscar ?? (() => []))(String(args.p_q), String(args.p_audiencia)), error: null }
      case 'cc_ia_producto_estado': { const r = o.estado ? o.estado(String(args.p_q)) : null; return r ? { data: r, error: null } : { data: null, error: { message: 'sin dato' } } }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true }, error: null }
      case 'cc_ia_turno_fallar': return { data: { estado: 'failed' }, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: null, error: null }
      case 'cc_solicitar_asesor': return { data: { modo: 'human_requested', asesor: false }, error: null }
      case '_cc_canal_transferir': return { data: true, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas }
}
function deps(db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0], historial: H[], extra: Partial<DepsOrquestador> = {}, pol: typeof politicaCanal = politicaCanal, val: typeof validacionCanal = validacionCanal) {
  return {
    rpc: db.rpc, leerMensajes: async () => historial,
    proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 45_000, maxRondas: 4, historial: 12 },
    politica: pol, herramientas, validacion: val, reglasConocimiento: REGLAS_IA, conversacion, ...extra,
  } as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
}
const entrada = (texto: string, o: { canal?: 'whatsapp' | 'portal'; adjunto?: boolean } = {}) => ({ conv: CONV, triggerSeq: 17, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: texto, canal: o.canal ?? 'whatsapp',
  ...(o.adjunto ? { adjunto: { tipo: 'image' as const, media_type: 'image/jpeg', data: 'AAAA' } } : {}) })
const persistidos = (db: ReturnType<typeof base>) => db.llamadas.filter((l) => l.fn === 'cc_ia_turno_responder').map((l) => String(l.args.p_content))

// ═══ 3 · «SÍ MANEJAMOS» SOLO CON EVIDENCIA ═════════════════════════════════════════════════════════════════════════════
describe('3 · qué puede afirmar de un producto (cc_ia_producto_estado)', () => {
  it('sumarExistencia: con existencia → confirmado; sin existencia → no; presentación que no manejamos; no aparece; parecido no confirma', () => {
    const ex = conversacion.existenciaVacia()
    conversacion.sumarExistencia(ex, EST_INNOTOX); conversacion.sumarExistencia(ex, EST_NABOTA150); conversacion.sumarExistencia(ex, EST_HYALUX); conversacion.sumarExistencia(ex, EST_LINURASE)
    conversacion.sumarExistencia(ex, { consulta: 'xeomeen', coincidencia: 'parecida', pedidos: [{ nombre: 'Xeomeen 100 UI', disponible_ahora: true }] })
    expect(ex.confirmados).toEqual(['Linurase 100 UI']); expect(ex.sinExistencia).toEqual(['INNOTOX 100 UI'])
    expect(ex.presentacionNo).toEqual(['nabota 150 UI']); expect(ex.noEncontrado).toEqual(['hyalux deep'])
    expect(ex.alternativas.slice(0, 2)).toEqual(['Botox 100 UI', 'NABOTA 100 UI'])
  })
  it('la nota que acompaña al resultado le dice al modelo qué afirmar (sin cifras)', () => {
    expect(conversacion.notaExistencia(EST_INNOTOX)).toMatch(/NO se puede surtir ahora.*por ahora no está disponible.*Botox 100 UI o NABOTA 100 UI/)
    expect(conversacion.notaExistencia(EST_NABOTA150)).toMatch(/\(150 UI\) NO la manejamos.*NABOTA 100 UI o NABOTA 200 UI/)
    expect(conversacion.notaExistencia(EST_HYALUX)).toMatch(/NO digas que lo manejamos.*UNA pregunta/)
    expect(conversacion.notaExistencia({ coincidencia: 'parecida', consulta: 'xeomeen' })).toMatch(/pregúntale si se refiere/)
    expect(conversacion.notaExistencia(EST_LINURASE)).toMatch(/Sí lo manejamos/)
    for (const e of [EST_INNOTOX, EST_NABOTA150, EST_HYALUX, EST_LINURASE]) expect(conversacion.notaExistencia(e) ?? '').not.toMatch(/\d+ (piezas|unidades en)/)
  })
  it('B·C2 seq5 «Sí, manejamos INNOTOX 100 UI» con INNOTOX sin existencia → afirmación sin existencia', () => {
    const ex = conversacion.sumarExistencia(conversacion.existenciaVacia(), EST_INNOTOX)
    expect(conversacion.revisarAfirmaciones('Sí, manejamos INNOTOX 100 UI. Es de venta exclusiva para profesionales.', ex).problemas).toEqual(['afirma_sin_existencia'])
    expect(conversacion.revisarAfirmaciones('INNOTOX 100 UI por ahora no lo tengo disponible; te puedo ofrecer Botox 100 UI. ¿Te sirve?', ex).problemas).toEqual([])
    expect(conversacion.revisarAfirmaciones('Sí tenemos Botox 100 UI. ¿Cuántas piezas?', ex).problemas).toEqual([])
  })
  it('B·C1 seq21 «Sí manejamos … NABOTA 200 UI» (agotado: la vendedora dijo «lo tengo agotado» en seq26)', () => {
    const ex = conversacion.sumarExistencia(conversacion.existenciaVacia(), EST_NABOTA200_AGOTADO)
    expect(conversacion.revisarAfirmaciones('Buen día. Sí manejamos Linurase 100 UI y NABOTA 200 UI.', ex).problemas).toEqual(['afirma_sin_existencia'])
    expect(conversacion.revisarAfirmaciones('Sí manejamos NABOTA 100 UI. ¿Cuántas piezas?', ex).problemas).toEqual([])
  })
  it('A·C4 seq23 (vendedora: «solo de 150U»): «sí manejamos Nabota 150» cuando esa presentación no existe → sin evidencia', () => {
    const ex = conversacion.sumarExistencia(conversacion.existenciaVacia(), EST_NABOTA150)
    expect(conversacion.revisarAfirmaciones('Sí, manejamos Nabota 150 UI.', ex).problemas).toEqual(['afirma_sin_evidencia'])
  })
  it('A·C1 seq4 «Hyalux Deep» (no está en el catálogo) → nunca «sí manejamos Hyalux Deep»; respaldo con UNA pregunta', () => {
    const ex = conversacion.sumarExistencia(conversacion.existenciaVacia(), EST_HYALUX)
    expect(conversacion.revisarAfirmaciones('¡Claro! Sí manejamos Hyalux Deep.', ex).problemas).toEqual(['afirma_sin_evidencia'])
    const r = conversacion.textoRespaldoExistencia(ex, 'Alejandra')
    expect(r).toContain('lo confirmo con Alejandra'); expect((r.match(/\?/g) ?? []).length).toBe(1); expect(r).not.toMatch(/manejamos/)
  })
  it('respaldo sin existencia: lo dice y ofrece lo que el servidor dio (como la vendedora en B·C1 seq28)', () => {
    const ex = conversacion.sumarExistencia(conversacion.existenciaVacia(), EST_NABOTA200_AGOTADO)
    expect(conversacion.textoRespaldoExistencia(ex)).toBe('Ahorita no tengo NABOTA 200 UI disponible. Te puedo ofrecer NABOTA 100 UI o Wondertox 200 UI. ¿Te sirve?')
  })
  it('consultas de presentación de lo que escribió (A·C4 seq4 «tres toxinas nabota de 200 unidades», B·C2 seq3 «innotox de 100 u»)', () => {
    expect(conversacion.consultasExistencia('Me gustaría hacer un pedido de tres toxinas nabota de 200 unidades por favor')).toEqual(['nabota 200 ui'])
    expect(conversacion.consultasExistencia('Disculpe, quería checar si tendrían innotox de 100 u ✨')).toEqual(['innotox 100 ui'])
    expect(conversacion.consultasExistencia('MOUNJARO 5mg')).toEqual(['mounjaro 5 mg'])
    expect(conversacion.consultasExistencia('Hola buen día')).toEqual([])
  })
  it('validación: con SIN_EXISTENCIA_EVIDENCE «no está disponible / agotado» pasa; afirmar existencias sigue exigiendo STOCK_EVIDENCE', () => {
    const c = { evidencia: ['SIN_EXISTENCIA_EVIDENCE'], nombresAutorizados: ['INNOTOX 100 UI', 'Botox 100 UI'], nombresCatalogo: [], limiteClinico: false }
    expect(validacion.validarRespuesta('INNOTOX 100 UI no está disponible ahorita; te puedo ofrecer Botox 100 UI.', c).ok).toBe(true)
    expect(validacion.validarRespuesta('Está agotado por ahora.', c).ok).toBe(true)
    expect(validacion.validarRespuesta('Sí hay existencias de Botox 100 UI.', c)).toMatchObject({ ok: false, motivo: 'stock_sin_evidencia' })
    expect(validacion.validarRespuesta('INNOTOX 100 UI está agotado por ahora.', { ...c, evidencia: [] })).toMatchObject({ ok: false, motivo: 'stock_sin_evidencia' })
  })
  it('evidenciaDe(buscar_productos): la existencia del servidor da SIN_EXISTENCIA_EVIDENCE (sin perder KNOWLEDGE)', () => {
    expect(herramientas.evidenciaDe('buscar_productos', { productos: [{ product_id: BOTOX, nombre: 'Botox 100 UI' }], existencia: EST_INNOTOX })).toEqual(['KNOWLEDGE_EVIDENCE', 'SIN_EXISTENCIA_EVIDENCE'])
    expect(herramientas.evidenciaDe('buscar_productos', { productos: [], existencia: EST_NABOTA150 })).toEqual(['SIN_EXISTENCIA_EVIDENCE'])
    expect(herramientas.evidenciaDe('buscar_productos', [{ product_id: BOTOX, nombre: 'Botox 100 UI' }])).toEqual(['KNOWLEDGE_EVIDENCE'])
  })
  it('pre-búsqueda: lo «parecido» (error de dedo, < 75) se junta aparte; nunca entra a los confirmados', async () => {
    const parecidos: politica.ProductoEncontrado[] = []
    const pre = await politica.prebuscarProductos('Tiene Xomeen?', async () => ({ data: [{ product_id: 'x1', nombre: 'Xeomeen 100 UI', coincidencia: 'parecido', puntaje: 66 }], error: null }), parecidos)
    expect(pre).toEqual([]); expect(parecidos.map((p) => p.nombre)).toEqual(['Xeomeen 100 UI'])
  })
})

describe('3 · orquestador: B·C2 seq3-5 «innotox de 100 u» (sin existencia) → no «sí manejamos»; alternativa', () => {
  const innotox = (q: string, aud: string) => /innotox/.test(q) && aud === 'verified' ? [{ product_id: I100, nombre: 'INNOTOX 100 UI', puntaje: 90, coincidencia: 'nombre' }] : []
  it('el resultado de buscar_productos trae la existencia y la nota; la afirmación falsa se regenera y sale la honesta', async () => {
    const db = base({ buscar: innotox, estado: (q) => /innotox/.test(q) ? EST_INNOTOX : null })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'innotox 100' } }]),
      respuestaTexto('Sí, manejamos INNOTOX 100 UI. ¿Cuántas piezas necesitas?'),
      respuestaTexto('INNOTOX 100 UI no lo tengo disponible por ahora; te puedo ofrecer Botox 100 UI. ¿Te sirve?')],
      [{ actor: 'visitor', content: 'Disculpe, quería checar si tendrían innotox de 100 u ✨' }])
    await ejecutarTurno(entrada('Disculpe, quería checar si tendrían innotox de 100 u ✨'), d)
    const resultado = JSON.stringify(d.proveedor.solicitudes[1].messages)
    expect(resultado).toContain('disponible_ahora'); expect(resultado).toContain('no está disponible'); expect(resultado).not.toMatch(/"disponible":\d/)
    expect(d.proveedor.solicitudes[2].system).toContain('NO se puede surtir ahora (INNOTOX 100 UI)')
    expect(persistidos(db)).toEqual(['INNOTOX 100 UI no lo tengo disponible por ahora; te puedo ofrecer Botox 100 UI. ¿Te sirve?'])
  })
  it('si la regeneración insiste, el texto fijo honesto (con la alternativa del servidor)', async () => {
    const db = base({ buscar: innotox, estado: (q) => /innotox/.test(q) ? EST_INNOTOX : null })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'innotox 100' } }]),
      respuestaTexto('¡Sí, manejamos INNOTOX 100 UI!'), respuestaTexto('¡Claro, sí tenemos INNOTOX 100 UI!')],
      [{ actor: 'visitor', content: 'Checar si tienen innotox de 100 u' }])
    await ejecutarTurno(entrada('Checar si tienen innotox de 100 u'), d)
    expect(persistidos(db)).toEqual(['Ahorita no tengo INNOTOX 100 UI disponible. Te puedo ofrecer Botox 100 UI o NABOTA 100 UI. ¿Te sirve?'])
  })
  it('pre-búsqueda: «nabota de 200 unidades» se consulta al servidor antes del modelo (A·C4 seq4)', async () => {
    const db = base({ estado: (q) => q === 'nabota 200 ui' ? EST_NABOTA200_AGOTADO : null })
    const d = deps(db, [respuestaTexto('La de 200 UI no la tengo disponible ahorita; te puedo ofrecer NABOTA 100 UI. ¿Te sirve?')],
      [{ actor: 'visitor', content: 'Me gustaría hacer un pedido de tres toxinas nabota de 200 unidades por favor' }])
    await ejecutarTurno(entrada('Me gustaría hacer un pedido de tres toxinas nabota de 200 unidades por favor'), d)
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_producto_estado' && l.args.p_q === 'nabota 200 ui' && l.args.p_audiencia === 'public')).toBe(true)
    expect(d.proveedor.solicitudes[0].system).toContain('existencia_de_lo_que_pidio'); expect(d.proveedor.solicitudes[0].system).toContain('NABOTA 200 UI NO se puede surtir ahora')
    expect(persistidos(db)).toEqual(['La de 200 UI no la tengo disponible ahorita; te puedo ofrecer NABOTA 100 UI. ¿Te sirve?'])
  })
  it('sin el servidor de existencia (función ausente) todo sigue como en la Tanda 1', async () => {
    const db = base({ buscar: innotox })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'innotox 100' } }]), respuestaTexto('Sí, manejamos INNOTOX 100 UI. ¿Cuántas piezas necesitas?')],
      [{ actor: 'visitor', content: 'innotox 100' }])
    await ejecutarTurno(entrada('innotox 100'), d)
    expect(persistidos(db)).toEqual(['Sí, manejamos INNOTOX 100 UI. ¿Cuántas piezas necesitas?'])
  })
  it('público: un resultado solo «parecido» no tapa el catálogo profesional (Innotox no es «Botox parecido»)', async () => {
    const db = base({ buscar: (q, aud) => aud === 'public' ? [{ product_id: BOTOX, nombre: 'Botox 100 UI', puntaje: 63, coincidencia: 'parecido' }] : innotox(q, aud), estado: () => EST_INNOTOX })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'innotox de 100 u' } }]), respuestaTexto('Por ahora no tengo INNOTOX 100 UI disponible. ¿Te ofrezco Botox 100 UI?')],
      [{ actor: 'visitor', content: 'innotox de 100 u' }])
    await ejecutarTurno(entrada('innotox de 100 u'), d)
    const resultado = JSON.stringify(d.proveedor.solicitudes[1].messages)
    expect(resultado).toContain('solo_para_profesionales'); expect(resultado).not.toContain(I100)
  })
})

describe('3 · búsqueda tolerante en la base (migración 20270407480000)', () => {
  it('pg_trgm en `extensions`, sinónimos de palabra completa y presentación normalizada', () => {
    expect(sql).toMatch(/create extension if not exists pg_trgm with schema extensions;/)
    for (const [a, b] of [['tirzepatida', 'mounjaro'], ['tirze', 'mounjaro'], ['xeomin', 'xeomeen'], ['xomeen', 'xeomeen'], ['terapia neural', 'tnm'], ['linurasse', 'linurase']]) expect(sql).toContain(`('${a}', '${b}'`)
    expect(sql).toContain("'\\1 ui'")   // «200u», «200 unidades» → «200 ui»
    expect(sql).toMatch(/q := regexp_replace\(q, '\^\\d\{1,3\} \(\?=\[a-z\]\)', ''\);/)   // «10 linurase» → «linurase»
  })
  it('cc_buscar_productos conserva firma y visibilidad; lo parecido solo sin coincidencia fuerte y con tope < 75', () => {
    expect(sql).toContain("raise exception 'IA-TANDA2: cambió cc_buscar_productos; revisar antes de aplicar'")
    expect(sql).toContain('not exists (select 1 from cand x where x.pts >= 55)')
    expect(sql).toMatch(/\(50 \+ round\(14 \* s\.sim \+ 6 \* extensions\.similarity/)   // 50 + 14 + 6 = 70 como máximo
    expect(sql).toContain('from vis p cross join lateral')   // solo lo que esa audiencia ve
  })
  it('cc_ia_producto_estado: solo servicio, sin cifras (sí/no), sin productos internos, ids solo de lo visible', () => {
    expect(sql).toMatch(/cc_ia_producto_estado[\s\S]*perform public\._cc_solo_servicio\(\);/)
    expect(sql).toContain("revoke all on function public.cc_ia_producto_estado(text, text) from public, anon, authenticated;")
    expect(sql).toContain('where (p.show_portal or p.show_landing) and not exists (select 1 from public.products c where c.parent_product_id = p.id)')
    expect(sql).toContain("'product_id', case when z.visible then z.id end")
    expect(sql).not.toMatch(/'(existencia|stock|cantidad|disponible)', *(coalesce\()?\(?select sum/)
  })
})

// ═══ 7 · DATOS CANÓNICOS ═══════════════════════════════════════════════════════════════════════════════════════════════
const FISCAL = 'Boulevard Pedro Infante 2911 Desarrollo Urbano Tres Rios'
describe('7 · dirección vigente, sin motivos inventados, envío sin contradecir', () => {
  it('A·C8 seq4/seq11 y B·C3 seq30: la dirección fiscal se detecta (aunque la escriba distinto); la sucursal no', () => {
    expect(conversacion.mencionaDireccionAnterior('Nuestra sucursal está en Boulevard Pedro Infante 2911, Desarrollo Urbano Tres Ríos, C.P. 80020.', FISCAL, SUCURSAL.direccion)).toBe(true)
    expect(conversacion.mencionaDireccionAnterior('Es en la sucursal de Blvd. Pedro Infante, Tres Ríos.', FISCAL, SUCURSAL.direccion)).toBe(true)
    expect(conversacion.mencionaDireccionAnterior(`Estamos en ${SUCURSAL.direccion}.`, FISCAL, SUCURSAL.direccion)).toBe(false)
    // si Dirección vuelve a poner Pedro Infante como sucursal (reapertura), ya no se bloquea
    expect(conversacion.mencionaDireccionAnterior('Estamos en Boulevard Pedro Infante 2911.', FISCAL, 'Boulevard Pedro Infante 2911, Tres Ríos, Culiacán')).toBe(false)
  })
  it('canal: la respuesta con la dirección anterior se rechaza y el respaldo da la sucursal (una sola fuente: sucursalDe)', () => {
    const deps2 = dependenciasCanal({ empresa: { direccion: FISCAL }, sucursal: { nombre: SUCURSAL.nombre, direccion: SUCURSAL.direccion } })
    const v = deps2.validacion.validarRespuesta('Estamos en Boulevard Pedro Infante 2911, Tres Ríos.', { evidencia: [], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })
    expect(v).toMatchObject({ ok: false, motivo: 'direccion_anterior' })
    expect(deps2.validacion.respuestaSegura('direccion_anterior', { limiteClinico: false, evidencia: [], textoLimiteClinico: '', textoGenerico: 'x' })).toBe(`Estamos en ${SUCURSAL.direccion}. ¿Pasarías a recoger o te lo enviamos?`)
    expect(deps2.validacion.validarRespuesta(`Estamos en ${SUCURSAL.direccion}.`, { evidencia: [], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false }).ok).toBe(true)
    expect(responderSrc).toContain("const anterior = n.empresa?.direccion ?? null; const sucursal = n.sucursal?.direccion ?? null")
  })
  it('prompt del canal: una sola dirección, no inventar motivos, envío con la regla y sin contradecir', () => {
    const c = politica.contextoCanal('whatsapp')
    expect(c).toContain('La ÚNICA dirección que das es la de la sucursal del bloque negocio')
    expect(c).toContain('No inventes explicaciones de lo que pasó («si ayer fue domingo, por eso…»)')
    expect(c).toContain('si alguien del equipo ya le cotizó con el envío incluido, no le sumes envío ni recalcules')
  })
  it('A·C8 seq4 «Si ayer fue domingo, por eso nadie contestó» se quita', () => {
    const r = conversacion.revisarTanda2('Atendemos de lunes a sábado de 10:00 a 18:00. Si ayer fue domingo, por eso nadie contestó. ¿Viene a recoger un pedido?', { rafaga: 'ayer acudí al local y nadie me contestaba' })
    expect(r.texto).toBe('Atendemos de lunes a sábado de 10:00 a 18:00. ¿Viene a recoger un pedido?')
    const venta = 'Tal vez te sirva más la de 200 porque rinde más. ¿Cuántas piezas?'
    expect(conversacion.revisarTanda2(venta, {}).texto).toBe(venta)   // una sugerencia de venta no es un motivo inventado
  })
  it('A·C2 seq63: la vendedora cotizó «con envío incluido» → la IA no vuelve a cobrar $600', () => {
    const previo = [{ actor: 'seller', content: '-2pzas Botox en $3,790.5 c/u= $7,581\n*total=* $22,971 con envío incluido y factura en caso de requerir' }]
    expect(conversacion.equipoIncluyoEnvio(previo)).toBe(true)
    const r = conversacion.revisarTanda2('Gracias, Kitzia, ya quedaron tus datos de envío. El envío cuesta $600 y es gratis en compras desde $5,000. ¿Te mando las cuentas?', { canal: true, envioIncluido: true, rafaga: 'Kitzia Alacio. Calle José María 12. Querétaro, Qro. Porfavor' })
    expect(r.texto).not.toContain('$600'); expect(r.texto).toContain('¿Te mando las cuentas?')
  })
  it('el costo de envío solo si lo pregunta (y entonces sí se dice)', () => {
    const t = 'Va. El envío a Querétaro cuesta $600; gratis desde $5,000. ¿Cuántas piezas?'
    expect(conversacion.revisarTanda2(t, { canal: true, rafaga: 'Quiero 2 botox' }).texto).not.toContain('$600')
    expect(conversacion.revisarTanda2(t, { canal: true, rafaga: '¿Cuánto cuesta el envío a Querétaro?' }).texto).toContain('$600')
  })
  it('el resumen que calculó el servidor (revisar pedido) y el «te faltan $X para el envío gratis» del portal no se tocan', () => {
    const resumen = 'Te queda así: 2 Botox 100 UI, envío $600, total $8,580. ¿Lo confirmo?'
    expect(conversacion.revisarTanda2(resumen, { canal: true, resumenPedido: true, envioIncluido: true, rafaga: 'a mi consultorio' }).texto).toBe(resumen)
    const falta = 'Te faltan $420 para el envío gratis en Culiacán. ¿Agrego algo?'
    expect(conversacion.revisarTanda2(falta, { canal: false, rafaga: 'ver carrito' }).texto).toBe(falta)
    expect(conversacion.revisarTanda2(falta, { canal: true, rafaga: 'ok' }).texto).toBe(falta)
  })
})

// ═══ 8 · MEDIOS Y QUIÉN ESCRIBE ════════════════════════════════════════════════════════════════════════════════════════
describe('8 · imágenes, audios y documentos consistentes', () => {
  it('B·C4 seq33 «Por aquí no logro abrirla» cuando la IA SÍ recibió la imagen → regenerar', () => {
    expect(conversacion.revisarTanda2('Gracias por la imagen. Por aquí no logro abrirla, así que un asesor la revisa.', { adjuntoVisto: true, hablaronDePago: false }).problemas).toEqual(['niega_imagen'])
    expect(conversacion.revisarTanda2('Gracias por la imagen. No puedo ver imágenes por este medio.', { adjuntoVisto: true }).problemas).toContain('niega_imagen')
    expect(conversacion.revisarTanda2('Gracias por la imagen. Por aquí no logro abrirla.', { adjuntoVisto: false, hablaronDePago: true }).problemas).toEqual([])   // si de verdad no la vio, se vale decirlo
  })
  it('A·C2 seq60 «Gracias por enviar tu comprobante» sin que nadie hablara de pagar → no suponer', () => {
    expect(conversacion.hablaronDePago([{ actor: 'visitor', content: 'Gracias' }], 'Envió una imagen por WhatsApp.')).toBe(false)
    expect(conversacion.revisarTanda2('Gracias por enviar tu comprobante. Veo un recibo de pago.', { hablaronDePago: false }).problemas).toEqual(['supone_comprobante'])
    expect(conversacion.hablaronDePago([{ actor: 'seller', content: '¿Te mando las cuentas para tu pago?' }], 'Envió una imagen por WhatsApp.')).toBe(true)
    expect(conversacion.revisarTanda2('Gracias por tu comprobante; el equipo lo revisa.', { hablaronDePago: true }).problemas).toEqual([])
  })
  it('orquestador · con la imagen en el turno, «no puedo ver imágenes» se regenera (el cliente nunca lo ve)', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('Gracias. Por aquí no logro abrir la imagen. ¿Me dices qué producto es?'), respuestaTexto('Veo una caja de Botox 100 UI. ¿Cuántas piezas necesitas?')],
      [{ actor: 'ai', content: '¿En qué te ayudo?' }, { actor: 'visitor', content: 'Envió una imagen por WhatsApp. «Es este producto»' }])
    await ejecutarTurno(entrada('Envió una imagen por WhatsApp. «Es este producto»', { adjunto: true }), d)
    expect(d.proveedor.solicitudes[1].system).toContain('decía que no puedes ver la imagen')
    expect(persistidos(db)[0]).not.toMatch(/no logro abrir/)
  })
  it('A·C3 seq9/18/21/23 (cuatro audios): UNA línea honesta sin modelo; los siguientes, silencio (el equipo los escucha)', async () => {
    expect(conversacion.medioSinTexto(['Envió un audio por WhatsApp.'])).toBe('audio')
    expect(conversacion.medioSinTexto(['Envió un audio por WhatsApp.', 'Hola'])).toBeNull()
    const db = base()
    const d = deps(db, [], [{ actor: 'ai', content: '¿En qué te ayudo?' }, { actor: 'visitor', content: 'Envió un audio por WhatsApp.' }])
    const r = await ejecutarTurno(entrada('Envió un audio por WhatsApp.'), d)
    expect(r.estado).toBe('respondio'); expect(d.proveedor.solicitudes).toHaveLength(0)
    expect(persistidos(db)).toEqual(['Por aquí no alcanzo a escuchar audios. ¿Me lo escribes, por favor?'])
    expect(conversacion.yaPidioEscribirAudio([{ actor: 'ai', content: persistidos(db)[0] }])).toBe(true)
    expect(responderSrc).toContain("&& conversacion.yaPidioEscribirAudio(conversacion.historialPrevio(hist))) return 'silenciada'")
    expect(responderSrc.indexOf('yaPidioEscribirAudio')).toBeLessThan(responderSrc.indexOf("const motivo = politica.transferenciaDeterminista(texto)"))   // antes de reclamar el turno
  })
  it('prompt: nunca negar la imagen que ve; no suponer comprobantes; audio en una línea y una vez', () => {
    const c = politica.contextoCanal('whatsapp')
    expect(c).toContain('nunca digas que no puedes ver imágenes cuando la estás viendo')
    expect(c).toContain('No supongas que una imagen es un comprobante de pago salvo que claramente lo sea')
    expect(c).toContain('No se lo repitas si ya se lo dijiste')
  })
})

describe('8 · quién escribe: bots, terceros, enfermería, pacientes, revendedores', () => {
  it('A·C11 seq2 (menú «escribe *Menú*») y A·C4 seq3 (bienvenida automática de otra clínica): silencio desde el primero', () => {
    const MENU = '👋 Hola, parece que nos perdimos de vista. Estoy aquí para ayudarte cuando lo necesites.\n\nRecuerda que puedes escribir *Menú* en cualquier momento para volver al inicio.\n\n¡Estaré aquí cuando me necesites! 👋"'
    const BIENV = '¡Hola! 👋 Bienvenido/a a Éclat de Vie – Medicina Estética y Regenerativa. ¿En qué puedo orientarte hoy? Si me enviaste una imagen o nota de voz, ¿me cuentas por texto tu duda para ayudarte mejor? 😊'
    expect(frenoBot([], MENU)).toBe('automatico'); expect(frenoBot([], BIENV)).toBe('automatico')
    expect(esClaramenteAutomatico('Responde 1 para ventas, 2 para soporte')).toBe(true)
    expect(frenoBot([], 'Me gustaría hacer un pedido de tres toxinas nabota de 200 unidades por favor')).toBeNull()
    expect(frenoBot([], 'La opción 2 me gusta, ¿cuánto cuesta?')).toBeNull()
  })
  it('tipos de contacto con frases reales', () => {
    expect(conversacion.tipoContacto(['Buena tarde le habló de farmacias del ahorro', 'Para corroborar la ubicación o dónde se entregará el pedido'])).toBe('tercero')   // A·C8 seq1-2
    expect(conversacion.tipoContacto(['Con cédula de enfermería se puede?'])).toBe('enfermeria')   // B·C4 seq26
    expect(conversacion.tipoContacto(['Ricardo montano', 'No tengo cedula solamente vendo los productos'])).toBe('revendedor')   // B·C5 seq9
    expect(conversacion.tipoContacto(['Yo distribuyo algunas marcas y me habían compartido precio anteriormente'])).toBe('revendedor')   // A·C5 seq10
    expect(conversacion.tipoContacto(['Hola, quiero botox para aplicarme en la cara'])).toBe('paciente')
    expect(conversacion.tipoContacto(['Quisiera comprar Nabota', 'Envió una imagen por WhatsApp.'])).toBeNull()
  })
  it('enfermería: directo «solo con cédula de médico» (B·C4 seq28 decía «un asesor confirma si aplica»)', () => {
    expect(conversacion.textoTipoContacto('enfermeria')).toContain('Vendemos SOLO con cédula profesional de médico')
    expect(conversacion.revisarTanda2('Vendemos a profesionales de la salud con cédula verificada. Un asesor confirma si tu cédula de enfermería aplica.', { tipo: 'enfermeria' }).problemas).toEqual(['enfermeria'])
    expect(conversacion.corregirTanda2('x', ['enfermeria'], {})).toBe(conversacion.MENSAJE_ENFERMERIA)
    expect(conversacion.revisarTanda2(conversacion.MENSAJE_ENFERMERIA, { tipo: 'enfermeria' }).problemas).toEqual([])
  })
  it('tercero: sin productos ni cédula; revendedor: se califica (empresa, constancia fiscal) y pasa al equipo', () => {
    expect(conversacion.revisarTanda2('Claro, sí manejamos toxinas. ¿Me pasas tu cédula?', { tipo: 'tercero' }).problemas).toEqual(['tercero'])
    expect(conversacion.textoTipoContacto('revendedor')).toMatch(/empresa de distribución establecida.*constancia de situación fiscal.*solicitar_asesor/)
    expect(conversacion.textoTipoContacto('paciente')).toContain('consultar con su médico')
  })
  it('orquestador · A·C8: la farmacia recibe la instrucción de tercero y el bloque de quién escribe', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto(`Estamos en ${SUCURSAL.direccion}, de lunes a sábado de 10:00 a 18:00. Le paso su mensaje al equipo para confirmarle la entrega.`)],
      [{ actor: 'visitor', content: 'Buena tarde le habló de farmacias del ahorro' }, { actor: 'visitor', content: 'Para corroborar la ubicación o dónde se entregará el pedido ya que el día de ayer acudí al local y nadie me contestaba' }])
    await ejecutarTurno(entrada('Para corroborar la ubicación o dónde se entregará el pedido ya que el día de ayer acudí al local y nadie me contestaba'), d)
    expect(d.proveedor.solicitudes[0].system).toContain('QUIÉN ESCRIBE (lo dijo): un tercero')
    expect(persistidos(db)).toHaveLength(1)
  })
})

// ═══ 9 · TRATO Y ENLACES ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('9 · trato: «doctora/doctor» y nombre solo si se sabe; nunca «doctor(a)»', () => {
  it('cómo se presenta o firma', () => {
    expect(conversacion.tratoCliente(['Hola, soy la Dra. Ana Ruiz, quiero información'])).toEqual({ trato: 'doctora', nombre: 'Ana' })
    expect(conversacion.tratoCliente(['Buenas, Dr. Luis Pérez'])).toEqual({ trato: 'doctor', nombre: 'Luis' })
    expect(conversacion.tratoCliente(['Me llamo Cindy Ornelas'])).toEqual({ trato: null, nombre: 'Cindy' })
    expect(conversacion.tratoCliente(['Quiero 10 linurase'])).toEqual({ trato: null, nombre: null })
    expect(conversacion.tratoCliente(['Soy enfermera'])).toEqual({ trato: null, nombre: null })
    expect(conversacion.tratoCliente([], 'Dra. Karla Méndez')).toEqual({ trato: 'doctora', nombre: 'Karla' })   // cuenta vinculada
  })
  it('A·C13 seq2/5 «¡Hola, doctor(a)!» y A·C0 seq15 «verificado(a)»: sin saberlo → neutro; sabiéndolo → su forma', () => {
    const nada = { trato: null, nombre: null }
    expect(conversacion.ajustarTrato('¡Hola, doctor(a)! Qué gusto saludarte.', nada)).toBe('¡Hola! Qué gusto saludarte.')
    expect(conversacion.ajustarTrato('Listo, doctor(a), ya quedó registrada tu solicitud.', nada)).toBe('Listo, ya quedó registrada tu solicitud.')
    expect(conversacion.ajustarTrato('¡Bienvenido(a) a Renovacell!', nada)).toBe('¡Te damos la bienvenida a Renovacell!')
    expect(conversacion.ajustarTrato('Con gusto, doctora. ¿Qué toxina buscas?', nada)).toBe('Con gusto. ¿Qué toxina buscas?')
    expect(conversacion.ajustarTrato('¡Hola, doctor(a)! Ya quedaste verificado(a).', { trato: 'doctora', nombre: 'Ana' })).toBe('¡Hola, doctora! Ya quedaste verificada.')
    expect(conversacion.ajustarTrato('Listo, quedaste verificado/a.', { trato: 'doctor', nombre: null })).toBe('Listo, quedaste verificado.')
    expect(conversacion.ajustarTrato('Con gusto, doctora Ana. ¿Qué toxina buscas?', { trato: 'doctora', nombre: 'Ana' })).toBe('Con gusto, doctora Ana. ¿Qué toxina buscas?')
    const resumen = 'Te queda así:\n2 Botox 100 UI\nTotal $7,980.\n\n¿Lo confirmo?'
    expect(conversacion.ajustarTrato(resumen, nada)).toBe(resumen)   // sin «(a)» ni vocativo: el texto (y sus saltos de línea) no se toca
  })
  it('el prompt dice cómo tratarlo y nunca «(a)»', () => {
    expect(conversacion.textoTrato({ trato: 'doctora', nombre: 'Ana' })).toContain('«doctora Ana»')
    expect(conversacion.textoTrato({ trato: null, nombre: null })).toContain('sin «doctor(a)», «bienvenido(a)», «verificado(a)»')
  })
  it('orquestador · el modelo escribe «doctor(a)» → se publica neutro (canal y portal)', async () => {
    for (const canal of ['whatsapp', 'portal'] as const) {
      const db = base()
      const d = deps(db, [respuestaTexto('¡Hola, doctor(a)! ¿Qué producto buscas?')], [{ actor: 'visitor', content: 'Hola' }])
      await ejecutarTurno(entrada('Hola', { canal }), d)
      expect(persistidos(db)[0], canal).toBe('¡Hola! ¿Qué producto buscas?')
    }
  })
})

describe('9 · enlaces al cliente solo con el dominio de la app (A·C0 seq15: enlace supabase.co)', () => {
  it('enlace para crear la contraseña: dominio de la app y el token en el fragmento', () => {
    expect(enlaceCrearContrasena('6974f2a4a7e9f0531426ba41aeee06564e976c38a0b6b92c5e1e77be')).toBe('https://sistema.renovacell.mx/sistema#token_hash=6974f2a4a7e9f0531426ba41aeee06564e976c38a0b6b92c5e1e77be&type=recovery')
    expect(enlaceCrearContrasena(null)).toBeNull(); expect(enlaceCrearContrasena('x y')).toBeNull()
    expect(esEnlaceDeLaApp('https://amurlvlvfohwucvxfdot.supabase.co/auth/v1/verify?token=abc&type=recovery')).toBe(false)
    expect(esEnlaceDeLaApp(enlaceCrearContrasena('6974f2a4a7e9f0531426ba41aeee0656'))).toBe(true)
  })
  it('alta-whatsapp manda el del dominio (hashed_token), ya no action_link', () => {
    expect(altaSrc).toContain('enlace = enlaceCrearContrasena((link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token)')
    expect(altaSrc).not.toMatch(/action_link/)
  })
  it('la app canjea el #token_hash (verifyOtp) y, si venció, el login lo explica', () => {
    expect(tokenRecuperacion('#token_hash=6974f2a4a7e9f0531426ba41aeee0656&type=recovery')).toBe('6974f2a4a7e9f0531426ba41aeee0656')
    expect(tokenRecuperacion('#access_token=abc&type=recovery')).toBeNull(); expect(tokenRecuperacion('#token_hash=abc&type=signup')).toBeNull()
    expect(roleSrc).toContain("supabase.auth.verifyOtp({ token_hash: th, type: 'recovery' })")
    expect(roleSrc).toContain("(error ? '#error_code=otp_expired' : '')")
  })
  it('cc_alta_wa_cerrar: sin «verificado(a)», descarta enlaces que no son de la app y no habla encima del vendedor', () => {
    const f = sql.slice(sql.indexOf('create or replace function public.cc_alta_wa_cerrar'), sql.indexOf('do $post$'))
    expect(f).not.toContain('verificado(a)'); expect(f).toContain('Tu cuenta quedó verificada en Renovacell')
    expect(f).toContain("v_enlace := case when p_enlace ~ '^https://sistema\\.renovacell\\.mx/[^\\s]*$' then p_enlace end;")
    expect(f).toMatch(/m\.actor_type in \('seller', 'admin'\) and m\.created_at > now\(\) - interval '30 minutes'/)
    expect(f).toMatch(/if v_equipo then\s+v_t := [^;]*Tu portal, para ver tus precios y tus pedidos/)
    expect(f.slice(f.indexOf('if v_equipo then'), f.indexOf('else', f.indexOf('if v_equipo then')))).not.toContain('¿Te cotizo')
  })
})

describe('examen: casos nuevos de la Tanda 2', () => {
  it('CV13–CV22 en la categoría conversacion, con debe/no_debe e ideal', () => {
    const ids = [...sql.matchAll(/\('(CV\d\d)', 'conversacion'/g)].map((m) => m[1])
    expect(ids).toEqual(['CV13', 'CV14', 'CV15', 'CV16', 'CV17', 'CV18', 'CV19', 'CV20', 'CV21', 'CV22'])
    expect(sql).toContain('on conflict (id) do nothing;')
  })
  it('el examen deja leer cc_ia_producto_estado (STABLE)', () => expect(examenSrc).toContain("'cc_ia_producto_estado'"))
})
