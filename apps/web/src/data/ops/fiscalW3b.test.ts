// W3-B · B5 — Estados de operador e invariantes del esquema.
// Lo que se protege: el estado `incierto` debe comunicar sin ambigüedad que no se sabe si
// el CFDI existe, que volver a emitir está prohibido, y que hace falta conciliar. Y el
// frontend nunca debe recibir permiso de reintentar desde ahí.
import { describe, it, expect } from 'vitest'
import {
  mensajeEstadoFiscal, etiquetaEstadoFiscal, SIN_SOLICITUD, type EstadoFiscalPedido,
} from './fiscalIntent'
import b1Src from '../../../../../supabase/migrations/20261017120000_w3b_b1_identidad.sql?raw'
import b2Src from '../../../../../supabase/migrations/20261017120100_w3b_b2_reclamo.sql?raw'
import b4Src from '../../../../../supabase/migrations/20261017120200_w3b_b4_conciliacion.sql?raw'
import b5Src from '../../../../../supabase/migrations/20261017120300_w3b_b5_autoridad.sql?raw'
import pacSrc from '../../../../../supabase/functions/_shared/pac.ts?raw'
import factSrc from '../../screens/admin/Facturacion.tsx?raw'

const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/|\*|\/\*)/.test(l)).join('\n')
const est = (o: Partial<EstadoFiscalPedido>): EstadoFiscalPedido => ({ ...SIN_SOLICITUD, ...o } as EstadoFiscalPedido)

describe('estado INCIERTO · las tres cosas que debe comunicar', () => {
  const e = est({ status: 'incierto', serie: 'REN', folio: '7', requiere_conciliacion: true })
  it('dice que la existencia del CFDI NO está resuelta', () => {
    expect(mensajeEstadoFiscal(e)).toMatch(/No sabemos si el SAT/)
  })
  it('dice que volver a emitir está PROHIBIDO', () => {
    expect(mensajeEstadoFiscal(e)).toMatch(/PROHIBIDO/)
    expect(mensajeEstadoFiscal(e)).toMatch(/duplicada/)
  })
  it('dice que hace falta conciliar', () => {
    expect(mensajeEstadoFiscal(e)).toMatch(/conciliar/)
  })
  it('NUNCA ofrece reintentar', () => {
    expect(e.puede_reintentar).toBe(false)
    expect(mensajeEstadoFiscal(e)).not.toMatch(/reintenta|vuelve a intentar|Reintentar/)
  })
  it('con varios candidatos, pide revisión manual', () => {
    const m = est({ status: 'incierto', requiere_revision_manual: true, serie: 'REN', folio: '7' })
    expect(mensajeEstadoFiscal(m)).toMatch(/más de un comprobante posible/)
    expect(mensajeEstadoFiscal(m)).toMatch(/revisión manual/)
    expect(etiquetaEstadoFiscal(m)).toBe('Revisión manual')
  })
})

describe('los demás estados se distinguen sin ambigüedad', () => {
  it('cada estado tiene mensaje y etiqueta propios', () => {
    const estados: EstadoFiscal[] = ['sin_solicitud', 'pendiente', 'en_proceso', 'timbrado', 'fallido', 'incierto', 'cancelado']
    const etiquetas = new Set(estados.map((s) => etiquetaEstadoFiscal(est({ status: s }))))
    expect(etiquetas.size).toBe(estados.length)
    for (const s of estados) expect(mensajeEstadoFiscal(est({ status: s })).length).toBeGreaterThan(10)
  })
  it('muestra la identidad fiscal cuando existe', () => {
    expect(mensajeEstadoFiscal(est({ status: 'timbrado', serie: 'REN', folio: '7', uuid: 'u-1' }))).toMatch(/REN-7/)
    expect(mensajeEstadoFiscal(est({ status: 'timbrado' }))).not.toMatch(/·\s*-/)
  })
  it('un fallo explica el motivo al operador', () => {
    expect(mensajeEstadoFiscal(est({ status: 'fallido', error_message: 'RFC del receptor no existe' })))
      .toMatch(/RFC del receptor no existe/)
  })
  it('W3-B no promete timbrado habilitado', () => {
    expect(SIN_SOLICITUD.timbrado_habilitado).toBe(false)
  })
})

describe('la pantalla no ofrece acción desde un estado ambiguo', () => {
  it('en incierto no hay botón, solo el aviso', () => {
    const i = factSrc.indexOf("fis.status === 'incierto'")
    const j = factSrc.indexOf("fis.status === 'en_proceso'")
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(factSrc.slice(i, j)).not.toMatch(/<button/)
  })
})

describe('ESQUEMA · identidad ante el proveedor', () => {
  it('la identidad de la operación es (Folio, Date), y el Date se guarda como TEXTO', () => {
    expect(b1Src).toMatch(/add column provider_date_sent text/)
    expect(b1Src).toMatch(/ck_fiscal_date_formato/)
    expect(b1Src).toMatch(/\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/)
  })
  it('la unicidad del folio NO depende de la serie (la deduplicación del PAC no la mira)', () => {
    expect(b1Src).toMatch(/create unique index uq_fiscal_folio_proveedor/)
    expect(b1Src).toMatch(/on public\.fiscal_documents\(provider, coalesce\(provider_env, ''\), coalesce\(issuer_rfc, ''\), folio\)/)
  })
  it('todo estado que llegó al proveedor lleva identidad completa', () => {
    expect(b1Src).toMatch(/ck_fiscal_identidad_proveedor/)
    expect(b1Src).toMatch(/issuer_rfc is not null/)
  })
  it('la guarda CONGELA la identidad fuera de pendiente', () => {
    expect(b1Src).toMatch(/FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA/)
    expect(b1Src).toMatch(/new\.folio is distinct from old\.folio/)
    expect(b1Src).toMatch(/new\.provider_date_sent is distinct from old\.provider_date_sent/)
  })
  it('la serie es REN y la declara el servidor', () => {
    expect(b1Src).toMatch(/values \('REN'/)
    expect(b1Src).toMatch(/ck_fiscal_serie_formato/)
  })
})

describe('ASIGNACIÓN · transaccional, monótona, nunca aleatoria', () => {
  it('un solo enunciado atómico con bloqueo de fila', () => {
    expect(b2Src).toMatch(/on conflict \(provider, provider_env, issuer_rfc\)/)
    expect(b2Src).toMatch(/do update set next_folio = public\.fiscal_folio_domains\.next_folio \+ 1/)
    expect(b2Src).toMatch(/returning next_folio - 1/)
  })
  it('bloquea la fila ANTES de consumir numeración', () => {
    const lock = b2Src.indexOf('for update')
    const alloc = b2Src.indexOf('_w3_asignar_folio(\'facturama\'')
    expect(lock).toBeGreaterThan(-1)
    expect(alloc).toBeGreaterThan(lock)
  })
  it('el perdedor ABORTA (para revertir la asignación), no devuelve null', () => {
    expect(b2Src).toMatch(/no se asigna un segundo folio/)
    expect(b2Src).toMatch(/raise exception 'CFDI_EN_PROCESO/)
  })
  it('un incierto no vuelve a reclamar ni recibe otro folio', () => {
    expect(b2Src).toMatch(/CFDI_INCIERTO.*no se asigna otro folio/s)
  })
  it('el Date se genera una vez, en el huso del negocio, y nunca desde now() al reenviar', () => {
    expect(b2Src).toMatch(/to_char\(now\(\) at time zone 'America\/Mazatlan', 'YYYY-MM-DD"T"HH24:MI:SS'\)/)
  })
  it('nada de aleatorios en la numeración', () => {
    const alloc = b2Src.slice(b2Src.indexOf('_w3_asignar_folio'), b2Src.indexOf('_w3_replay_vence'))
    expect(alloc).not.toMatch(/random\(|gen_random_uuid|clock_timestamp|Date\.now/)
  })
})

describe('VENTANA DE REENVÍO · margen explícito y central', () => {
  it('72 h legales menos 6 h de margen = 66 h operativas, definidas en un solo lugar', () => {
    expect(b1Src).toMatch(/_w3_plazo_timbrado\(\).*interval '72 hours'/s)
    expect(b1Src).toMatch(/_w3_margen_replay\(\).*interval '6 hours'/s)
    expect(b1Src).toMatch(/_w3_plazo_timbrado\(\) - public\._w3_margen_replay\(\)/)
  })
  it('el margen está justificado, no es un número mágico', () => {
    expect(b1Src).toMatch(/desfase de reloj/)
    expect(b1Src).toMatch(/latencia humana/)
  })
  it('vencida la ventana: la consulta y la adopción siguen; el reenvío no', () => {
    expect(b1Src).toMatch(/la conciliación por consulta y la adopción siguen permitidas/)
    expect(b2Src).toMatch(/replay_permitido/)
  })
})

describe('REGLA ASIMÉTRICA · congelada en la base', () => {
  it('la resolución negativa exige las cuatro condiciones', () => {
    expect(b4Src).toMatch(/FISCAL_EVIDENCIA_POSITIVA/)
    expect(b4Src).toMatch(/FISCAL_INTENTO_RECIENTE/)
    expect(b4Src).toMatch(/FISCAL_EVIDENCIA_INSUFICIENTE/)
    expect(b4Src).toMatch(/solo Dirección puede declarar que no existe comprobante/)
  })
  it('la separación temporal se demuestra con evidencia persistida, no con el frontend', () => {
    expect(b1Src).toMatch(/create table public\.fiscal_reconciliations/)
    expect(b4Src).toMatch(/v_ultimo - v_primero >= public\._w3_separacion_sondeos\(\)/)
  })
  it('un vacío NO concluye nada por sí mismo', () => {
    expect(b4Src).toMatch(/NO ENCONTRADO\s+→ no demuestra NADA/)
  })
  it('no se adopta un folio que el SAT no reconoce', () => {
    expect(b4Src).toMatch(/SAT_NO_ENCONTRADO/)
  })
  it('la conciliación detecta la identidad incompleta y la ventana vencida', () => {
    for (const c of ['C12_folio_repetido_proveedor', 'C13_identidad_incompleta',
                     'C14_ventana_reenvio_vencida', 'C15_evidencia_positiva_sin_adoptar',
                     'C16_candidatos_multiples']) {
      expect(b5Src).toMatch(new RegExp(c))
    }
  })
})

describe('W3-B no inventa política fiscal ni toca al proveedor', () => {
  it('ninguna migración contiene tasas, claves SAT ni método de pago', () => {
    for (const src of [b1Src, b2Src, b4Src, b5Src]) {
      expect(src).not.toMatch(/0\.16/)
      expect(src).not.toMatch(/51241100/)
      expect(src).not.toMatch(/'PUE'|'PPD'/)
    }
  })
  it('ninguna migración sale a la red', () => {
    for (const src of [b1Src, b2Src, b4Src, b5Src]) {
      expect(soloCodigo(src).toLowerCase()).not.toMatch(/https?:\/\//)
      expect(src).not.toMatch(/\bhttp_(get|post)\b|\bpg_net\b/i)
    }
  })
  it('el adaptador recibe fetch inyectado: se prueba sin Facturama', () => {
    expect(pacSrc).toMatch(/export interface DepsPAC/)
    expect(pacSrc).toMatch(/fetch: typeof fetch/)
    expect(soloCodigo(pacSrc)).not.toMatch(/facturama\.mx/)
  })
  it('la construcción del comprobante se niega sin renglones (D-W3-4 abierta)', () => {
    expect(pacSrc).toMatch(/class ConstruccionFiscalPendiente/)
    expect(pacSrc).toMatch(/construccion_fiscal_pendiente/)
  })
})

type EstadoFiscal = EstadoFiscalPedido['status']
