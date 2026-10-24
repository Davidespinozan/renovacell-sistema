// CX-V2-A/B · presentación de la entrega: todo importe viene de la revisión del servidor (regla + subtotal + flete por
// opción); solo se muestran las alternativas relevantes; cada tarjeta dice una cosa; la regla de selección es la de CX-V2-A.
import { describe, it, expect } from 'vitest'
import { avisoInvalidada, claveDireccion, elegirOpcion, faltantePara, resumenDireccion, tarjetasEntrega, tituloModalidad } from './entregaUx'
import type { OpcionesEntrega } from '../../data/ops/entrega'
import { opsPara } from './entregaUx.fixtures'

const find = (ops: OpcionesEntrega, id: string) => ops.opciones.find((x) => x.id === id)!
const ids = (ops: OpcionesEntrega) => tarjetasEntrega(ops, null, null).map((t) => t.id)
const tarjeta = (ops: OpcionesEntrega, id: string, sel: string | null = null) => tarjetasEntrega(ops, sel, null).find((t) => t.id === id)

describe('faltante con números del servidor', () => {
  it('local $350: mínimo 500, faltan 150; local $500: faltan 0; foráneo $1,050: mínimo 5,000, faltan 3,950', () => {
    expect(faltantePara(opsPara('80020', 350), { tipo: 'local' })).toEqual({ minimo: 500, faltante: 150 })
    expect(faltantePara(opsPara('80020', 500), { tipo: 'local' })).toEqual({ minimo: 500, faltante: 0 })
    expect(faltantePara(opsPara('82000', 1050), { tipo: 'foraneo' })).toEqual({ minimo: 5000, faltante: 3950 })
    expect(faltantePara(opsPara('82000', 1050), { tipo: 'recoge' })).toBeNull()
    const sinMin = { ...opsPara('80020', 100), regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 0 } }
    expect(faltantePara(sinMin, { tipo: 'local' })).toBeNull()   // nada hardcodeado: sin mínimo configurado no hay faltante
  })
  it('si Dirección cambia el mínimo, los textos lo siguen (no hay $500 fijo)', () => {
    const ops = { ...opsPara('80020', 350), regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 800 } }
    expect(tarjeta(ops, 'local_chofer')).toMatchObject({ precio: 'Gratis desde $800', linea: 'Agrega $450 en productos para recibirlo gratis' })
  })
})

describe('qué se muestra (solo lo relevante)', () => {
  it('Culiacán: recoger + entrega a domicilio; DHL (no aplica en la zona), T1 (inactivo) y mostrador (solo personal) no ocupan tarjeta', () => {
    expect(ids(opsPara('80020', 350))).toEqual(['recoge', 'local_chofer'])
    expect(ids(opsPara('80020', 500))).toEqual(['recoge', 'local_chofer'])
  })
  it('foráneo: recoger + DHL; el chofer (fuera de zona) y T1 no aparecen', () => {
    expect(ids(opsPara('82000', 1050))).toEqual(['recoge', 'foraneo_dhl'])
  })
  it('sin dirección: recoger + una sola tarjeta de entrega a domicilio que pide la dirección (no se duplica con DHL)', () => {
    expect(ids(opsPara(null, 350))).toEqual(['recoge', 'local_chofer'])
    expect(tarjeta(opsPara(null, 350), 'local_chofer')).toMatchObject({ titulo: 'Entrega a domicilio', precio: '', bloqueada: true, accion: 'direccion' })
  })
})

describe('texto de cada tarjeta (una cosa por tarjeta)', () => {
  it('local bajo el mínimo: título, "Gratis desde $500", "Agrega $150…" y la acción agregar; bloqueada', () => {
    expect(tarjeta(opsPara('80020', 350), 'local_chofer')).toEqual({ id: 'local_chofer', titulo: 'Entrega a domicilio', precio: 'Gratis desde $500', linea: 'Agrega $150 en productos para recibirlo gratis', accion: 'agregar', bloqueada: true })
  })
  it('local que cumple: "Gratis" y el horario; elegida con horario: la hora', () => {
    expect(tarjeta(opsPara('80020', 500), 'local_chofer')).toEqual({ id: 'local_chofer', titulo: 'Entrega a domicilio', precio: 'Gratis', linea: 'Eliges un horario de media hora', bloqueada: false })
    const t = tarjetasEntrega(opsPara('80020', 500), 'local_chofer', { fecha: '2026-10-21', inicio: '15:30' }).find((x) => x.id === 'local_chofer')
    expect(t?.linea).toBe('Llega hoy a las 15:30')
  })
  it('recoger: "Gratis", promesa y horario en una línea; el nombre de la sucursal no se repite', () => {
    const t = tarjeta(opsPara('80020', 350), 'recoge')!
    expect(t).toEqual({ id: 'recoge', titulo: 'Recoger en sucursal', precio: 'Gratis', linea: 'Listo para recoger hoy · Lunes a sábado de 10:00 a 18:00', bloqueada: false })
    expect(JSON.stringify(t)).not.toMatch(/Sucursal Renovacell|dirección/)
  })
  it('DHL foráneo con costo: precio real, promesa y el faltante UNA vez (nota + acción)', () => {
    expect(tarjeta(opsPara('82000', 1050), 'foraneo_dhl')).toEqual({ id: 'foraneo_dhl', titulo: 'Envío por DHL', precio: '$600', linea: 'Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct', nota: 'Gratis desde $5,000 · agrega $3,950', accion: 'agregar', bloqueada: false })
  })
  it('DHL foráneo gratis: "Gratis" y la promesa, sin nota ni acción', () => {
    expect(tarjeta(opsPara('82000', 5000), 'foraneo_dhl')).toEqual({ id: 'foraneo_dhl', titulo: 'Envío por DHL', precio: 'Gratis', linea: 'Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct', bloqueada: false })
  })
  it('ninguna tarjeta repite "Próximamente" ni el precio en su línea', () => {
    for (const ops of [opsPara('80020', 350), opsPara('80020', 500), opsPara('82000', 1050), opsPara('82000', 5000), opsPara(null, 350)]) {
      for (const t of tarjetasEntrega(ops, null, null)) {
        expect(t.linea).not.toMatch(/Próximamente/)
        if (t.precio) expect(t.linea).not.toContain(t.precio)
      }
    }
  })
})

describe('regla de selección (CX-V2-A, sin cambios)', () => {
  it('$350 local: recoger es la única elegible → se preselecciona', () => {
    expect(elegirOpcion(opsPara('80020', 350), null)).toEqual({ opcion: 'recoge', invalidada: null, unica: true })
  })
  it('$500 local: varias elegibles → la sugerida (chofer); una elección válida se conserva', () => {
    const ops = opsPara('80020', 500)
    expect(elegirOpcion(ops, null)).toEqual({ opcion: 'local_chofer', invalidada: null, unica: false })
    expect(elegirOpcion(ops, 'recoge')).toEqual({ opcion: 'recoge', invalidada: null, unica: false })
  })
  it('la elección que deja de ser válida se informa y se exige elegir de nuevo: nunca cambia sola a recoger', () => {
    const r = elegirOpcion(opsPara('80020', 350), 'local_chofer')
    expect(r.opcion).toBeNull(); expect(r.invalidada?.id).toBe('local_chofer')
    expect(avisoInvalidada(r.invalidada!, opsPara('80020', 350))).toBe('Entrega a domicilio: faltan $150 para el mínimo de $500. Elige otra opción.')
    const z = elegirOpcion(opsPara('80020', 1050), 'foraneo_dhl')
    expect(z.opcion).toBeNull(); expect(avisoInvalidada(z.invalidada!, opsPara('80020', 1050))).toBe('Envío por DHL: no aplica para esta dirección. Elige otra opción.')
    const t = elegirOpcion(opsPara('82000', 1050), 'foraneo_t1')
    expect(avisoInvalidada(t.invalidada!, opsPara('82000', 1050))).toBe('Envío por T1: ya no está disponible. Elige otra opción.')
  })
  it('sin dirección: recoger única; sugerida no elegible y varias opciones → ninguna', () => {
    expect(elegirOpcion(opsPara(null, 350), null)).toEqual({ opcion: 'recoge', invalidada: null, unica: true })
    expect(elegirOpcion({ ...opsPara('82000', 1050), sugerida: 'foraneo_t1' }, null)).toEqual({ opcion: null, invalidada: null, unica: false })
  })
})

describe('auxiliares', () => {
  it('títulos, clave y resumen de dirección', () => {
    expect(tituloModalidad(find(opsPara('80020', 1), 'foraneo_t1'))).toBe('Envío por T1')
    expect(claveDireccion(null)).toBe('ninguna')
    expect(claveDireccion({ address: { line1: 'x' }, locationId: 'L1' })).toBe('loc:L1')
    expect(claveDireccion({ address: { line1: 'x' } })).toBe('dir:{"line1":"x"}')
    expect(resumenDireccion({ line1: 'Av. del Mar 10', cp: '82000', city: 'Mazatlán' })).toBe('Av. del Mar 10 · C.P. 82000 Mazatlán')
    expect(resumenDireccion(null)).toBe('')
  })
})
