// CX-V2-A · fixture de pruebas: opciones de entrega como las arma el SERVIDOR para un doctor (espejo de entrega_opciones, 171).
import type { OpcionEntrega, OpcionesEntrega } from '../../data/ops/entrega'

const base = { salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21' }
const o = (p: Partial<OpcionEntrega> & Pick<OpcionEntrega, 'id' | 'tipo' | 'paqueteria' | 'texto'>): OpcionEntrega => ({ flete: 0, permitido: true, motivo: null, disponible: true, ...base, ...p })
/** Opciones como las arma el servidor para un DOCTOR con ese CP y ese importe (espejo de entrega_opciones de la 171). */
export function opsPara(cp: string | null, subtotal: number): OpcionesEntrega {
  const local = !!cp && cp >= '80000' && cp <= '80299'
  const fletFor = subtotal >= 5000 ? 0 : 600
  return {
    actor: 'doctor', subtotal, cp, local,
    corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-10-21' },
    regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 },
    recoge: { lugar: 'Sucursal Renovacell, Culiacán', horario: 'Lunes a sábado de 10:00 a 18:00' },
    sugerida: !cp ? null : local ? (subtotal < 500 ? 'recoge' : 'local_chofer') : 'foraneo_dhl',
    opciones: [
      o({ id: 'mostrador', tipo: 'mostrador', paqueteria: null, texto: 'Entrega en mostrador', permitido: false, motivo: 'SOLO_PERSONAL' }),
      o({ id: 'recoge', tipo: 'recoge', paqueteria: null, texto: 'Recoger en Sucursal Renovacell, Culiacán' }),
      o({ id: 'local_chofer', tipo: 'local', paqueteria: 'chofer', texto: 'Entrega local (chofer de Renovacell)', permitido: local && subtotal >= 500, motivo: !cp ? 'REQUIERE_DIRECCION' : !local ? 'ZONA_FORANEA' : subtotal < 500 ? 'MINIMO_LOCAL' : null }),
      o({ id: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', texto: 'Envío por DHL', flete: fletFor, permitido: !!cp && !local, motivo: !cp ? 'REQUIERE_DIRECCION' : local ? 'ZONA_LOCAL' : null, llega_desde: '2026-10-22', llega_hasta: '2026-10-26' }),
      o({ id: 'foraneo_t1', tipo: 'foraneo', paqueteria: 't1', texto: 'Envío por T1', flete: fletFor, permitido: !!cp && !local, motivo: !cp ? 'REQUIERE_DIRECCION' : local ? 'ZONA_LOCAL' : null, disponible: false }),
    ],
  }
}
