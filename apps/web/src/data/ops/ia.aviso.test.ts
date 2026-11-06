// AVISO-IA (6 nov 2026) · caso Emanuel: la IA mandó a la sucursal (en remodelación) y dijo «si ayer fue domingo» un viernes.
// Ahora: aviso vigente de Dirección que manda sobre dirección/horario, y fecha/hora reales con «abierto ahora».
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import { dependenciasCanal, dependenciasPortal } from '../../../../../supabase/functions/_shared/ia/responder'

const HORARIO = [1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abierto: true, abre: '10:00:00', cierra: '18:00:00' })).concat([{ dia: 7, abierto: false, abre: null as never, cierra: null as never }])
const VIERNES_1403 = '2026-11-06T21:03:00Z'   // viernes 6 nov, 14:03 en Culiacán (UTC-7)

describe('fecha y hora del turno', () => {
  it('día, fecha y hora de Culiacán; abierto en horario', () => {
    const t = politica.textoAhora({ ahora: VIERNES_1403, horario: HORARIO })
    expect(t).toMatch(/^Hoy es viernes 6 de noviembre de 2026, 14:03 \(hora de Culiacán\); en este momento estamos en horario de atención\./)
    expect(t).toMatch(/no supongas qué día fue ayer/)
  })
  it('domingo o de noche: fuera de horario', () => {
    expect(politica.textoAhora({ ahora: '2026-11-08T19:00:00Z', horario: HORARIO })).toMatch(/domingo 8 de noviembre.*FUERA de horario/)
    expect(politica.textoAhora({ ahora: '2026-11-07T02:30:00Z', horario: HORARIO })).toMatch(/viernes 6 de noviembre de 2026, 19:30.*FUERA de horario/)
  })
  it('sin instante no dice nada', () => expect(politica.textoAhora({ horario: HORARIO })).toBe(''))
})

describe('aviso vigente de Dirección', () => {
  const aviso = { texto: 'La sucursal está cerrada por remodelación. No invites a ir; las entregas se coordinan con un asesor.', hasta: '2026-11-20' }
  it('vigente: manda sobre la dirección y el horario', () => {
    expect(politica.textoAviso({ aviso, ahora: VIERNES_1403 })).toMatch(/^AVISO VIGENTE DE RENOVACELL \(manda sobre la dirección, el horario.*\): La sucursal está cerrada por remodelación/)
  })
  it('vence al terminar el día `hasta`; sin fecha no vence; vacío no cuenta', () => {
    expect(politica.textoAviso({ aviso: { ...aviso, hasta: '2026-11-06' }, ahora: VIERNES_1403 })).not.toBe('')
    expect(politica.textoAviso({ aviso: { ...aviso, hasta: '2026-11-05' }, ahora: VIERNES_1403 })).toBe('')
    expect(politica.textoAviso({ aviso: { ...aviso, hasta: null }, ahora: VIERNES_1403 })).not.toBe('')
    expect(politica.textoAviso({ aviso: { texto: '   ', hasta: null }, ahora: VIERNES_1403 })).toBe('')
  })
  it('canal y portal: el aviso y la fecha van ANTES de los datos del negocio', () => {
    const n: politica.DatosNegocio = { aviso, ahora: VIERNES_1403, horario: HORARIO, empresa: { direccion: 'Boulevard Pedro Infante 2911', ciudad: 'Culiacán' } }
    const e: politica.EntradaSistema = { ctx: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false } as never, intencion: 'GENERAL', limiteClinico: false, reglasConocimiento: [], evidencia: [] }
    for (const d of [dependenciasCanal(n), dependenciasPortal(n)]) {
      const s = d.politica.construirSistema(e)
      const iAviso = s.indexOf('AVISO VIGENTE'), iHoy = s.indexOf('Hoy es viernes'), iDir = s.indexOf('Boulevard Pedro Infante 2911')
      expect(iAviso).toBeGreaterThan(0); expect(iHoy).toBeGreaterThan(iAviso); expect(iDir).toBeGreaterThan(iHoy)
    }
  })
})
