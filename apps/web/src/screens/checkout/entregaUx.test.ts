// CX-V2-A · textos y regla de selección de la entrega: todo importe viene de la revisión del servidor (regla + subtotal +
// flete por opción); nada se inventa. Un 404 de reglas no existe aquí: cada estado tiene su causa real.
import { describe, it, expect } from 'vitest'
import { avisoInvalidada, claveDireccion, descripcionOpcion, elegirOpcion, etiquetaOpcion, faltantePara, llamadaFaltante, opcionesVisibles } from './entregaUx'
import type { OpcionesEntrega } from '../../data/ops/entrega'
import { opsPara } from './entregaUx.fixtures'

const find = (ops: OpcionesEntrega, id: string) => ops.opciones.find((x) => x.id === id)!
const ctx = { hoy: '2026-10-21', seleccionada: false, horario: null }

describe('faltante con números del servidor', () => {
  it('local $350: mínimo 500, faltan 150; local $500: faltan 0; foráneo $1,050: mínimo 5,000, faltan 3,950', () => {
    expect(faltantePara(opsPara('80020', 350), { tipo: 'local' })).toEqual({ minimo: 500, faltante: 150 })
    expect(faltantePara(opsPara('80020', 500), { tipo: 'local' })).toEqual({ minimo: 500, faltante: 0 })
    expect(faltantePara(opsPara('82000', 1050), { tipo: 'foraneo' })).toEqual({ minimo: 5000, faltante: 3950 })
    expect(faltantePara(opsPara('82000', 1050), { tipo: 'recoge' })).toBeNull()
    // si Dirección pone el mínimo en 0, no hay faltante que mostrar (nada hardcodeado)
    const sinMin = { ...opsPara('80020', 100), regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 0 } }
    expect(faltantePara(sinMin, { tipo: 'local' })).toBeNull()
  })
})

describe('textos por estado (doctor en Culiacán con $350)', () => {
  const ops = opsPara('80020', 350)
  it('local bajo el mínimo: chip "Gratis desde $500" y explicación con lo que lleva y lo que falta', () => {
    expect(etiquetaOpcion(find(ops, 'local_chofer'), ops)).toBe('Gratis desde $500')
    expect(descripcionOpcion(find(ops, 'local_chofer'), ops, ctx)).toBe('Gratis desde $500. Llevas $350 en productos: te faltan $150 para la entrega a tu domicilio.')
  })
  it('DHL en zona local: causa real (chofer o recoger), nunca un "no aplica" genérico', () => {
    expect(etiquetaOpcion(find(ops, 'foraneo_dhl'), ops)).toBe('No aplica en tu zona')
    expect(descripcionOpcion(find(ops, 'foraneo_dhl'), ops, ctx)).toMatch(/^Dentro de Culiacán entregamos con nuestro chofer o puedes recoger en sucursal\./)
  })
  it('T1 apagado: Próximamente, aunque la regla lo permitiera', () => {
    expect(etiquetaOpcion(find(ops, 'foraneo_t1'), ops)).toBe('Próximamente')
    expect(descripcionOpcion(find(ops, 'foraneo_t1'), ops, ctx)).toMatch(/^Próximamente/)
  })
  it('recoger: promesa, horario de la sucursal y aviso de que no se usa la dirección', () => {
    expect(etiquetaOpcion(find(ops, 'recoge'), ops)).toBe('Gratis')
    expect(descripcionOpcion(find(ops, 'recoge'), ops, ctx)).toBe('Listo para recoger hoy · Lunes a sábado de 10:00 a 18:00. No usaremos tu dirección de entrega.')
  })
  it('la llamada a agregar productos solo aparece cuando agregar cambia la entrega', () => {
    expect(llamadaFaltante(ops)).toEqual({ texto: 'Agregar productos para entrega gratis', minimo: 500, faltante: 150 })
    expect(llamadaFaltante(opsPara('80020', 500))).toBeNull()
    expect(llamadaFaltante(opsPara('82000', 1050))).toEqual({ texto: 'Agregar productos para envío gratis', minimo: 5000, faltante: 3950 })
    expect(llamadaFaltante(opsPara('82000', 5000))).toBeNull()
    expect(llamadaFaltante(opsPara(null, 350))).toBeNull()   // sin dirección no hay regla que alcanzar todavía
  })
})

describe('textos por estado (otros)', () => {
  it('foráneo con costo: promesa + cuánto falta para el gratis; foráneo gratis: solo la promesa', () => {
    const f = opsPara('82000', 1050)
    expect(etiquetaOpcion(find(f, 'foraneo_dhl'), f)).toBe('$600')
    expect(descripcionOpcion(find(f, 'foraneo_dhl'), f, ctx)).toBe('Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct · Gratis desde $5,000: te faltan $3,950.')
    const g = opsPara('82000', 5000)
    expect(descripcionOpcion(find(g, 'foraneo_dhl'), g, ctx)).toBe('Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct')
    expect(etiquetaOpcion(find(f, 'local_chofer'), f)).toBe('Fuera de zona')
    expect(descripcionOpcion(find(f, 'local_chofer'), f, ctx)).toMatch(/fuera de la zona de entrega local/)
  })
  it('sin dirección: las opciones a domicilio piden dirección; recoger sigue disponible', () => {
    const s = opsPara(null, 350)
    expect(etiquetaOpcion(find(s, 'local_chofer'), s)).toBe('Falta dirección')
    expect(descripcionOpcion(find(s, 'foraneo_dhl'), s, ctx)).toBe('Agrega una dirección de entrega para ver esta opción.')
    expect(opcionesVisibles(s).map((x) => x.id)).toEqual(['recoge', 'local_chofer', 'foraneo_dhl', 'foraneo_t1'])   // mostrador (solo personal) no se muestra
  })
  it('entrega local elegible: horario pendiente o elegido', () => {
    const l = opsPara('80020', 500)
    expect(descripcionOpcion(find(l, 'local_chofer'), l, ctx)).toBe('Eliges un horario de media hora')
    expect(descripcionOpcion(find(l, 'local_chofer'), l, { hoy: '2026-10-21', seleccionada: true, horario: { fecha: '2026-10-21', inicio: '15:30' } })).toBe('Llega hoy a las 15:30')
  })
})

describe('regla de selección', () => {
  it('$350 local: recoger es la única elegible → se preselecciona y se marca como única', () => {
    expect(elegirOpcion(opsPara('80020', 350), null)).toEqual({ opcion: 'recoge', invalidada: null, unica: true })
  })
  it('$500 local: varias elegibles → la sugerida del servidor (chofer); una elección válida se conserva', () => {
    const ops = opsPara('80020', 500)
    expect(elegirOpcion(ops, null)).toEqual({ opcion: 'local_chofer', invalidada: null, unica: false })
    expect(elegirOpcion(ops, 'recoge')).toEqual({ opcion: 'recoge', invalidada: null, unica: false })
  })
  it('la elección que deja de ser válida se informa y se exige elegir de nuevo: nunca cambia sola a recoger', () => {
    const r = elegirOpcion(opsPara('80020', 350), 'local_chofer')   // tenía chofer con $500 y el carrito bajó a $350
    expect(r.opcion).toBeNull(); expect(r.invalidada?.id).toBe('local_chofer'); expect(r.unica).toBe(true)
    expect(avisoInvalidada(r.invalidada!, opsPara('80020', 350))).toBe('Tu pedido ya no cumple para Entrega local (chofer de Renovacell) (mínimo $500, te faltan $150). Elige otra forma de entrega.')
    const z = elegirOpcion(opsPara('80020', 1050), 'foraneo_dhl')   // tenía DHL y cambió a una dirección de Culiacán
    expect(z.opcion).toBeNull(); expect(avisoInvalidada(z.invalidada!, opsPara('80020', 1050))).toMatch(/la dirección cambió de zona/)
    const t = elegirOpcion(opsPara('82000', 1050), 'foraneo_t1')
    expect(avisoInvalidada(t.invalidada!, opsPara('82000', 1050))).toMatch(/ya no está disponible/)
  })
  it('sin dirección: solo recoger → única; sin sugerida elegible y varias opciones → ninguna', () => {
    expect(elegirOpcion(opsPara(null, 350), null)).toEqual({ opcion: 'recoge', invalidada: null, unica: true })
    const ops = { ...opsPara('82000', 1050), sugerida: 'foraneo_t1' }   // sugerida no elegible (apagada)
    expect(elegirOpcion(ops, null)).toEqual({ opcion: null, invalidada: null, unica: false })
  })
  it('clave de dirección: ubicación guardada, dirección nueva o ninguna', () => {
    expect(claveDireccion(null)).toBe('ninguna')
    expect(claveDireccion({ address: null })).toBe('ninguna')
    expect(claveDireccion({ address: { line1: 'x' }, locationId: 'L1' })).toBe('loc:L1')
    expect(claveDireccion({ address: { line1: 'x' } })).toBe('dir:{"line1":"x"}')
  })
})
