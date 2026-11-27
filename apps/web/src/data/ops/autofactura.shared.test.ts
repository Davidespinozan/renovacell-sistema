// AUTOFACTURA POR QR (27 nov 2026) · la llave del enlace, la fecha límite y lo que ve el cliente. Lógica sin red.
import { describe, it, expect } from 'vitest'
import {
  correoEnmascarado, diaNegocio, enlaceFactura, estadoAutofactura, faltaEnReceptor, fechaLarga, fechaLimite, leerEnlace, limpiarReceptor,
  llaveDePedido, llaveValida, mensajeDeError, MENSAJE_ESTADO,
} from '../../../../../supabase/functions/_shared/autofactura'
import edge from '../../../../../supabase/functions/autofactura/index.ts?raw'
import mig from '../../../../../supabase/migrations/20270408060000_autofactura_qr.sql?raw'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const SECRETO = 'secreto-de-prueba-con-mas-de-16'

describe('llave del enlace', () => {
  it('es estable para el mismo pedido, distinta para otro pedido y para otro secreto', async () => {
    const a = await llaveDePedido(P1, SECRETO)
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(await llaveDePedido(P1.toUpperCase(), SECRETO)).toBe(a)
    expect(await llaveDePedido(P2, SECRETO)).not.toBe(a)
    expect(await llaveDePedido(P1, SECRETO + 'x')).not.toBe(a)
  })
  it('solo abre el pedido para el que se hizo', async () => {
    const a = await llaveDePedido(P1, SECRETO)
    expect(await llaveValida(P1, a, SECRETO)).toBe(true)
    expect(await llaveValida(P2, a, SECRETO)).toBe(false)                       // la llave de una compra no abre otra
    expect(await llaveValida(P1, a.slice(0, 21) + (a[21] === 'A' ? 'B' : 'A'), SECRETO)).toBe(false)
    expect(await llaveValida(P1, '', SECRETO)).toBe(false)
    expect(await llaveValida('no-es-un-pedido', a, SECRETO)).toBe(false)
  })
  it('el enlace lleva pedido y llave en el fragmento, y se vuelve a leer igual', async () => {
    const a = await llaveDePedido(P1, SECRETO)
    const url = enlaceFactura(P1, a)
    expect(url).toBe(`https://sistema.renovacell.mx/factura#${P1}.${a}`)
    expect(leerEnlace(new URL(url).hash)).toEqual({ pedido: P1, llave: a })
    for (const malo of ['', '#', '#' + P1, `#${P1}.corta`, '#otra-cosa.' + a]) expect(leerEnlace(malo)).toBeNull()
  })
})

describe('fecha límite: el último día del mes de la venta (día de Culiacán)', () => {
  it('noviembre → 30 de noviembre; febrero → 28; diciembre → 31', () => {
    expect(fechaLimite('2026-11-27T18:00:00Z')).toBe('2026-11-30')
    expect(fechaLimite('2027-02-10T18:00:00Z')).toBe('2027-02-28')
    expect(fechaLimite('2026-12-05T18:00:00Z')).toBe('2026-12-31')
    expect(fechaLarga('2026-11-30')).toBe('30 de noviembre de 2026')
  })
  it('una venta de la noche del último día sigue siendo de ese mes (06:30Z del día 1 = 23:30 del 30 en Culiacán)', () => {
    expect(diaNegocio('2026-12-01T06:30:00Z')).toBe('2026-11-30')
    expect(fechaLimite('2026-12-01T06:30:00Z')).toBe('2026-11-30')
  })
})

describe('lo que ve el cliente', () => {
  const base = { status_pedido: 'paid', venta: '2026-11-27T18:00:00Z', hoy: '2026-11-27', fiscal_status: null, timbrada: false, en_global: false }
  it('dentro del mes puede pedirla; el último día todavía', () => {
    expect(estadoAutofactura(base)).toBe('disponible')
    expect(estadoAutofactura({ ...base, hoy: '2026-11-30' })).toBe('disponible')
  })
  it('pasado el mes ya no: va en la global a público en general', () => {
    expect(estadoAutofactura({ ...base, hoy: '2026-12-01' })).toBe('fuera_de_mes')
    expect(estadoAutofactura({ ...base, en_global: true })).toBe('en_global')
    expect(MENSAJE_ESTADO.fuera_de_mes).toMatch(/público en general/)
  })
  it('una pedida a tiempo se puede corregir aunque ya cambió el mes', () => {
    expect(estadoAutofactura({ ...base, hoy: '2026-12-03', fiscal_status: 'pendiente' })).toBe('solicitada')
  })
  it('lo ya hecho manda: timbrada, en proceso y cancelada', () => {
    expect(estadoAutofactura({ ...base, fiscal_status: 'timbrado' })).toBe('facturada')
    expect(estadoAutofactura({ ...base, timbrada: true, hoy: '2027-01-01' })).toBe('facturada')
    expect(estadoAutofactura({ ...base, fiscal_status: 'en_proceso' })).toBe('en_proceso')
    expect(estadoAutofactura({ ...base, fiscal_status: 'incierto' })).toBe('en_proceso')
    expect(estadoAutofactura({ ...base, status_pedido: 'cancelled', fiscal_status: 'pendiente' })).toBe('cancelada')
  })
})

describe('datos fiscales que escribe el cliente', () => {
  const ok = { rfc: 'gode561231gr8 ', razon_social: ' Dra. Uno ', regimen: '612', cp: '80020', uso_cfdi: 'g03', email_facturacion: ' Dra@X.MX ' }
  it('se limpian (mayúsculas, espacios) y nada más que los seis datos pasa', () => {
    const r = limpiarReceptor({ ...ok, otro: 'x', validado: true })
    expect(r).toEqual({ rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', email_facturacion: 'dra@x.mx' })
    expect(faltaEnReceptor(r)).toBeNull()
  })
  it('dice qué falta, de uno en uno y en palabras del cliente', () => {
    const r = limpiarReceptor(ok)
    expect(faltaEnReceptor({ ...r, rfc: '' })).toMatch(/RFC/)
    expect(faltaEnReceptor({ ...r, rfc: 'ABC' })).toMatch(/12 .* 13/)
    expect(faltaEnReceptor({ ...r, rfc: '1234567890123' })).toMatch(/formato/)
    expect(faltaEnReceptor({ ...r, razon_social: '' })).toMatch(/constancia/)
    expect(faltaEnReceptor({ ...r, regimen: '' })).toMatch(/régimen/)
    expect(faltaEnReceptor({ ...r, cp: '8002' })).toMatch(/5 números/)
    expect(faltaEnReceptor({ ...r, uso_cfdi: '' })).toMatch(/uso/)
    expect(faltaEnReceptor({ ...r, email_facturacion: 'sin-arroba' })).toMatch(/correo/)
    expect(faltaEnReceptor(limpiarReceptor(null))).toMatch(/RFC/)
  })
  it('los errores de la base se dicen en palabras, nunca con el texto interno', () => {
    expect(mensajeDeError('FACTURA_FUERA_DE_MES: la venta es de 01/10/2026…').estado).toBe('fuera_de_mes')
    expect(mensajeDeError('FACTURA_EN_GLOBAL: …').estado).toBe('en_global')
    expect(mensajeDeError('PEDIDO_CANCELADO: …').estado).toBe('cancelada')
    expect(mensajeDeError('CFDI_INCIERTO: …').estado).toBe('en_proceso')
    const raro = mensajeDeError('relation "x" does not exist')
    expect(raro.estado).toBe('error'); expect(raro.mensaje).not.toMatch(/relation/)
  })
  it('el correo se confirma enmascarado', () => {
    expect(correoEnmascarado('juan.perez@clinica.mx')).toBe('j•••@clinica.mx')
    expect(correoEnmascarado('')).toBeNull()
  })
})

describe('la Edge y la base', () => {
  it('lo público pasa por el límite ANTES de validar la llave, y nunca timbra', () => {
    expect(edge.indexOf("scope: 'autofactura_ver'")).toBeLessThan(edge.indexOf('llaveValida(pedido'))
    expect(edge).not.toMatch(/timbrarEnPAC|reclamar_cfdi|facturama/i)
    expect(edge).toContain("admin.rpc('solicitar_cfdi'")
  })
  it('los enlaces solo salen de pedidos que la sesión de quien pregunta ya puede leer', () => {
    expect(edge).toContain("caller.from('orders').select('id, created_at').in('id', ids)")
    expect(edge).toContain("q.quien.role === 'doctor'")
  })
  it('la migración solo agrega al servidor como solicitante; la regla del mes y la global siguen', () => {
    expect(mig).toContain("= 'service_role' then v_role := 'cliente_qr'")
    expect(mig).toContain('FACTURA_FUERA_DE_MES'); expect(mig).toContain('FACTURA_EN_GLOBAL')
    expect(mig).not.toMatch(/alter table|create table|create index|drop /i)
  })
})
