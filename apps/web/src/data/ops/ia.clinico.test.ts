// IA-CLÍNICA · con la información clínica habilitada para el actor (lo dice la base), la pregunta de etiqueta se responde con
// las secciones T2 aprobadas del turno; una cifra clínica sin esa evidencia se rechaza. Para todos los demás, el límite de siempre.
import { describe, it, expect } from 'vitest'
import { construirSistema, POLITICA_CLINICA, TAREA_CLINICA, esLimiteClinico } from '../../../../../supabase/functions/_shared/ia/politica'
import { evidenciaDe } from '../../../../../supabase/functions/_shared/ia/herramientas'
import { validarRespuesta, respuestaSegura, MENSAJE_CLINICO_SIN_FICHA } from '../../../../../supabase/functions/_shared/ia/validacion'
import orquestadorSrc from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'

const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }
const clinico = { ...doctor, clinico: true }
const base = { intencion: 'CLINICAL_BOUNDARY', limiteClinico: false, reglasConocimiento: [], evidencia: [] }
const val = (t: string, evidencia: string[], limiteClinico = false) => validarRespuesta(t, { evidencia, nombresAutorizados: [], nombresCatalogo: [], limiteClinico })
const RESPUESTA = 'Según la etiqueta de la FDA, para glabela se recomienda inyectar 20 unidades en 5 sitios de 4 U.'

describe('prompt', () => {
  it('con clínico: reglas C1–C5 y la tarea de etiqueta en vez del límite', () => {
    const s = construirSistema({ ...base, ctx: clinico })
    expect(s).toContain(POLITICA_CLINICA)
    expect(s).toContain(TAREA_CLINICA)
    expect(s).not.toMatch(/Responde el límite con claridad/)
  })
  it('también en el canal cuando el actor tiene clínico', () => {
    expect(construirSistema({ ...base, ctx: clinico, canal: 'whatsapp' })).toContain(TAREA_CLINICA)
  })
  it('sin clínico (T2 apagado, sin verificar o visitante): el límite de siempre y sin reglas clínicas', () => {
    for (const ctx of [doctor, { ...doctor, verificado: false, audiencia: 'public' }, { ...doctor, actor: 'visitor', audiencia: 'public', verificado: false }]) {
      const s = construirSistema({ ...base, limiteClinico: true, ctx })
      expect(s).not.toContain('INFORMACIÓN CLÍNICA:')
      expect(s).toMatch(/Responde el límite con claridad/)
    }
  })
  it('las reglas exigen fuente, fidelidad a la etiqueta y que la decisión sea del médico', () => {
    expect(POLITICA_CLINICA).toMatch(/obtener_ficha_producto o buscar_conocimiento/)
    expect(POLITICA_CLINICA).toMatch(/fuera de etiqueta/)
    expect(POLITICA_CLINICA).toMatch(/la decisión clínica es suya/)
  })
})

describe('evidencia y validación', () => {
  it('una sección T2 en la ficha es evidencia clínica; T0/T1 no', () => {
    expect(evidenciaDe('obtener_ficha_producto', { conocimiento: { protocolo: { nivel: 'T2', contenido: 'Glabela 20 U' } } })).toEqual(['KNOWLEDGE_EVIDENCE', 'CLINICAL_EVIDENCE'])
    expect(evidenciaDe('buscar_conocimiento', [{ seccion: 'resumen', nivel: 'T0' }])).toEqual(['KNOWLEDGE_EVIDENCE'])
  })
  it('cifra clínica: pasa con evidencia clínica, se rechaza sin ella y con el límite sigue el rechazo de siempre', () => {
    expect(val(RESPUESTA, ['KNOWLEDGE_EVIDENCE', 'CLINICAL_EVIDENCE'])).toMatchObject({ ok: true })
    expect(val(RESPUESTA, ['KNOWLEDGE_EVIDENCE'])).toEqual({ ok: false, motivo: 'clinico_sin_evidencia' })
    expect(val(RESPUESTA, ['CLINICAL_EVIDENCE'], true)).toEqual({ ok: false, motivo: 'clinico' })
    expect(val('El Botox viene en frasco de 100 U y se conserva refrigerado.', [])).toMatchObject({ ok: true })
  })
  it('el respaldo no inventa ni niega: pide el producto para revisar la etiqueta', () => {
    expect(respuestaSegura('clinico_sin_evidencia', { limiteClinico: false, evidencia: [], textoLimiteClinico: 'x', textoGenerico: 'y' })).toBe(MENSAJE_CLINICO_SIN_FICHA)
  })
})

describe('orquestador', () => {
  it('el límite fijo solo aplica a quien no tiene clínico (lo decide la base)', () => {
    expect(esLimiteClinico('cual es la dosis de botox para glabela')).toBe(true)
    expect(orquestadorSrc).toMatch(/const limiteClinico = d\.politica\.esLimiteClinico\(e\.textoUsuario\) && !ctx\.clinico/)
  })
})
