// ENT-P · PARIDAD de reglas de venta: el aviso de envío gratis es uno (doctor y vendedor), la cortesía del personal abajo
// del mínimo exige motivo, y la IA del portal recibe los mismos datos del negocio que la de WhatsApp con el faltante del
// carrito calculado igual que en las pantallas. Sin red ni base real.
import { describe, it, expect } from 'vitest'
import { avisoEnvioGratis, faltantePara, localBajoMinimo, type OpcionesEntrega } from './entrega'
import { opsPara } from '../../screens/checkout/entregaUx.fixtures'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import { dependenciasPortal } from '../../../../../supabase/functions/_shared/ia/responder'
import selectorSrc from '../../app/SelectorEntrega.tsx?raw'
import catalogoSrc from '../../screens/doctor/Catalogo.tsx?raw'
import carritoSrc from '../../screens/chat/CarritoPanel.tsx?raw'
import responderSrc from '../../../../../supabase/functions/_shared/ia/responder.ts?raw'
import migSrc from '../../../../../supabase/migrations/20270128120000_entrega_paridad.sql?raw'

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const staff = (cp: string | null, subtotal: number): OpcionesEntrega => ({ ...opsPara(cp, subtotal), actor: 'staff' })

describe('ENT-P · aviso de envío gratis (mismo cálculo en todas las pantallas)', () => {
  it('Culiacán abajo del mínimo: cuánto falta para el chofer gratis y que puede recoger', () => {
    const a = avisoEnvioGratis(opsPara('80020', 350), money)!
    expect(a).toMatchObject({ alcanzado: false, faltante: 150, titulo: 'Te faltan $150 para la entrega gratis con chofer' })
    expect(a.detalle).toMatch(/gratis desde \$500 · también se puede recoger sin costo/)
    expect(a.avance).toBeCloseTo(0.7)
  })
  it('Culiacán desde el mínimo: ya es gratis', () => {
    expect(avisoEnvioGratis(opsPara('80020', 500), money)).toMatchObject({ alcanzado: true, faltante: 0, titulo: 'Tu entrega con chofer en Culiacán es gratis' })
  })
  it('foráneo: cuánto falta para $5,000 y cuánto cuesta si no', () => {
    const a = avisoEnvioGratis(opsPara('82000', 3800), money)!
    expect(a).toMatchObject({ alcanzado: false, faltante: 1200, titulo: 'Te faltan $1,200 para el envío gratis' })
    expect(a.detalle).toBe('Gratis desde $5,000 · si no, el envío cuesta $600')
    expect(avisoEnvioGratis(opsPara('82000', 5000), money)).toMatchObject({ alcanzado: true, titulo: 'Tu envío es gratis' })
  })
  it('sin dirección: las dos zonas', () => {
    const a = avisoEnvioGratis(opsPara(null, 350), money)!
    expect(a.titulo).toBe('Te faltan $4,650 para el envío gratis a todo México')
    expect(a.detalle).toBe('En Culiacán, chofer gratis desde $500 (faltan $150)')
    expect(avisoEnvioGratis(opsPara(null, 800), money)!.detalle).toBe('En Culiacán, la entrega con chofer ya es gratis')
  })
  it('en voz del vendedor: "al cliente le faltan"', () => {
    expect(avisoEnvioGratis(staff('82000', 3800), money, 'staff')!.titulo).toBe('Al cliente le faltan $1,200 para el envío gratis')
  })
  it('sin mínimos configurados no inventa nada', () => {
    const o = opsPara('82000', 100); const sin = { ...o, regla: { ...o.regla, foraneo_gratis_desde: 0, local_gratis_desde: 0 } }
    expect(avisoEnvioGratis(sin, money)).toBeNull()
    expect(avisoEnvioGratis(null, money)).toBeNull()
  })
  it('faltantePara vive en data/ops/entrega (el checkout lo re-exporta)', () => {
    expect(faltantePara(opsPara('80020', 350), { tipo: 'local' })).toEqual({ minimo: 500, faltante: 150 })
  })
})

describe('ENT-P · cortesía del personal abajo del mínimo', () => {
  it('solo el personal, solo chofer local, solo abajo del mínimo', () => {
    expect(localBajoMinimo(staff('80020', 350), { tipo: 'local' })).toBe(true)
    expect(localBajoMinimo(staff('80020', 500), { tipo: 'local' })).toBe(false)
    expect(localBajoMinimo(staff('80020', 350), { tipo: 'recoge' })).toBe(false)
    expect(localBajoMinimo(opsPara('80020', 350), { tipo: 'local' })).toBe(false)   // el doctor ni siquiera puede elegirlo
  })
  it('el selector exige el motivo antes de dejar continuar y el servidor también', () => {
    expect(selectorSrc).toMatch(/localBajoMinimo\(ops, o\) && !\(value\.motivo && value\.motivo\.trim\(\)\.length >= 3\)/)
    expect(migSrc).toMatch(/ENTREGA_MINIMO_SIN_MOTIVO/)
    expect(migSrc).toMatch(/'bajo_minimo', case when v_bajo then true end/)
    expect(migSrc).toMatch(/p_actor = 'staff' and o ->> 'tipo' = 'local'/)
  })
})

describe('ENT-P · las pantallas usan el MISMO aviso', () => {
  it('Catálogo (panel y barra móvil), carrito del chat y entrega del vendedor', () => {
    expect(catalogoSrc).toMatch(/useAvisoEnvioGratis\(/); expect(catalogoSrc).toMatch(/<AvisoEnvioGratisVista aviso=\{envio\}/); expect(catalogoSrc).toMatch(/envio=\{envio\?\.titulo/)
    expect(carritoSrc).toMatch(/useAvisoEnvioGratis\(/); expect(carritoSrc).toMatch(/<AvisoEnvioGratisVista/)
    expect(selectorSrc).toMatch(/avisoEnvioGratis\(ops, money, 'staff'\)/)
  })
})

const ERP: politica.DatosNegocio = {
  empresa: { razon_social: 'Renovacell', ciudad: 'Culiacan', estado: 'Sinaloa' },
  entrega: { cp_local_desde: '80000', cp_local_hasta: '80299', dias_chofer: [1, 2, 3, 4, 5, 6], local_mismo_dia: true, corte: '15:30:00', local_gratis_desde: 500, local_costo: 0, dias_paqueteria: [1, 2, 3, 4, 5], dhl_transito_min: 1, dhl_transito_max: 3, foraneo_costo: 600, foraneo_gratis_desde: 5000 },
  promociones: [{ nombre: 'Promo Allergan', hasta: '2026-10-31', productos: ['Botox 100 UI'] }],
}
const carrito = (monto: number) => ({ cart_id: 'c1', puede_precio: true, total: { estado: 'completo', monto }, items: [{ product_id: 'p1', nombre: 'X', precio: { estado: 'autorizado', unitario: monto } }] })

describe('ENT-P · IA del portal: mismos datos que WhatsApp y el faltante del carrito', () => {
  it('envioGratisCarrito: mismos números que las pantallas', () => {
    expect(politica.envioGratisCarrito(ERP, 3800)).toEqual({
      culiacan: { gratis_desde: 500, faltante: 0, alcanzado: true, si_no_llega: 'se recoge en sucursal sin costo' },
      resto_del_pais: { gratis_desde: 5000, faltante: 1200, alcanzado: false, flete_si_no_llega: 600 },
    })
    expect(politica.envioGratisCarrito({}, 100)).toBeNull()
  })
  it('ver_carrito y preparar_checkout llevan envio_gratis solo con total autorizado; el filtro de llaves no lo quita', () => {
    const v = politica.conEnvioGratis('ver_carrito', carrito(350), ERP) as Record<string, any>
    expect(v.envio_gratis.culiacan.faltante).toBe(150)
    expect(JSON.parse(herramientas.acotarSalida(v)).envio_gratis.resto_del_pais.flete_si_no_llega).toBe(600)
    const p = politica.conEnvioGratis('preparar_checkout', { cart_id: 'c1', proyeccion: carrito(4000) }, ERP) as Record<string, any>
    expect(p.envio_gratis.resto_del_pais.faltante).toBe(1000)
    const sinPrecio = { ...carrito(350), puede_precio: false }
    expect(politica.conEnvioGratis('ver_carrito', sinPrecio, ERP)).toBe(sinPrecio)
    expect(politica.conEnvioGratis('buscar_productos', carrito(350), ERP)).toEqual(carrito(350))
  })
  it('el sistema del portal trae negocio, promociones y la regla de envío gratis', () => {
    const d = dependenciasPortal(ERP)
    const s = d.politica.construirSistema({ ctx: { actor: 'doctor', audiencia: 'professional', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, intencion: 'CHECKOUT', limiteClinico: false, reglasConocimiento: [], evidencia: [] })
    expect(s).toContain('envío gratis en compras desde $500')
    expect(s).toContain('gratis en compras desde $5,000')
    expect(s).toContain('Promo Allergan')
    expect(s).toContain(politica.REGLA_ENVIO_GRATIS_PORTAL)
    expect(d.herramientas.complementar('ver_carrito', carrito(350))).toHaveProperty('envio_gratis')
  })
  it('validación del portal: los montos de envío del ERP pasan en frases de envío; otra cifra sigue exigiendo evidencia', () => {
    const d = dependenciasPortal(ERP)
    const ctx = { evidencia: [] as string[], nombresAutorizados: [] as string[], nombresCatalogo: [] as string[], limiteClinico: false }
    expect(d.validacion.validarRespuesta('El envío es gratis desde $5,000. En Culiacán la entrega con chofer es gratis desde $500.', ctx)).toEqual({ ok: true, texto: 'El envío es gratis desde $5,000. En Culiacán la entrega con chofer es gratis desde $500.' })
    expect(d.validacion.validarRespuesta('El Botox cuesta $4,000.', ctx)).toMatchObject({ ok: false, motivo: 'precio_sin_evidencia' })
    expect(d.validacion.respuestaSegura).toBe(validacion.respuestaSegura)   // el portal conserva sus mensajes seguros
  })
  it('responder: el portal ya no queda sin datos del negocio', () => {
    expect(responderSrc).toMatch(/const portalDeps = canal === 'portal' \? dependenciasPortal\(negocio\) : null/)
    expect(responderSrc).not.toMatch(/canal === 'portal' \? null : dependenciasCanal/)
  })
})
