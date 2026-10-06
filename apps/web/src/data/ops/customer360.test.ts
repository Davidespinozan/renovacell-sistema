// C360-F2B → C360-F3 — el modelo de la ficha viene del SERVIDOR (cliente_360, redactado por rol). Aquí se
// verifica lo que el navegador decide: qué pestañas existen por rol (solo con datos canónicos), las
// respuestas rápidas del resumen y que el cliente de comandos no manda autoridad.
import { describe, it, expect } from 'vitest'
import { ClienteC360, pestanasDe, telefonoPrincipal, domicilioPredeterminado, perfilFiscalPredeterminado, estadoVerificacion, lineaDomicilio, mensajeError360, type Cliente360 } from './customer360'

const base = (x: Partial<Cliente360> = {}): Cliente360 => ({
  customer_id: 'C', rol: 'direccion',
  permisos: { contacto: ['full_name', 'email', 'city', 'country'], telefonos: true, domicilios: true, fiscal: true, notas: true, cartera: true, adoptar_alta: true },
  resumen: { nombre: 'Dra. Ruiz', activo: true, creado_at: null, origen: 'portal', portal: { tiene: true, verificado: true, activo: true }, vendedor: { nombre: 'Ana', desde: null, elegible: true }, vendedor_historico: 'Importado' },
  contacto: { email: 'r@x.mx', ciudad: 'Mazatlán', pais: 'México', telefonos: [{ id: 't2', numero: '669 2', etiqueta: 'celular', es_principal: false, origen: 'manual' }, { id: 't1', numero: '669 1', etiqueta: 'whatsapp', es_principal: true, origen: 'manual' }], alta: null, notas: [] },
  domicilios: { lista: [{ id: 'l1', name: 'Casa', is_default: false, line1: 'Calle 1', postal_code: '82000', city: 'Mazatlán', state: 'Sinaloa' } as never, { id: 'l2', name: 'Consultorio', is_default: true, line1: 'Av. 2', exterior_number: '10', postal_code: '82100', city: 'Mazatlán', state: 'Sinaloa', municipio: 'Mazatlán' } as never], archivados: 0, alta: null },
  facturacion: [{ id: 'f1', alias: 'Clínica', rfc: 'AAA010101AA1', es_predeterminado: true }],
  comercial: { historial: [], atribucion: { origen: null, referido: null, prospecto: null }, conversacion: null, carrito: null },
  pedidos: [], resumen_pedidos: { n: 0, total: 0, ultimo: null }, pagos: [], facturas: [], actividad: [],
  profesional: { cedula: '123', organizacion: null, especialidad: null, verificado: true, verification: null, sep: null, identidad: null, ultimo_acceso: null },
  ...x,
})

describe('pestañas por rol (solo dominios con datos canónicos)', () => {
  it('Dirección: todas', () => {
    expect(pestanasDe(base())).toEqual(['resumen', 'contacto', 'domicilios', 'facturacion', 'comercial', 'pedidos', 'pagos', 'facturas', 'conversacion', 'actividad'])
  })
  it('doctor: sin comercial/conversación/actividad (el servidor no las manda)', () => {
    const d = base({ rol: 'dueno', comercial: undefined, actividad: undefined, profesional: undefined })
    expect(pestanasDe(d)).toEqual(['resumen', 'contacto', 'domicilios', 'facturacion', 'pedidos', 'pagos', 'facturas'])
  })
  it('vendedor: sin pagos (el servidor no los manda)', () => {
    expect(pestanasDe(base({ rol: 'vendedor', pagos: undefined }))).not.toContain('pagos')
  })
})

describe('respuestas rápidas del resumen', () => {
  it('teléfono principal, domicilio y perfil predeterminados; sin inventar', () => {
    const d = base()
    expect(telefonoPrincipal(d)?.id).toBe('t1'); expect(domicilioPredeterminado(d)?.id).toBe('l2'); expect(perfilFiscalPredeterminado(d)?.id).toBe('f1')
    const vacio = base({ contacto: { ...base().contacto, telefonos: [] }, domicilios: { lista: [], archivados: 0, alta: null }, facturacion: [] })
    expect(telefonoPrincipal(vacio)).toBeNull(); expect(domicilioPredeterminado(vacio)).toBeNull(); expect(perfilFiscalPredeterminado(vacio)).toBeNull()
  })
  it('verificación: sin portal / verificado / pendiente', () => {
    expect(estadoVerificacion(base({ resumen: { ...base().resumen, portal: { tiene: false, verificado: false, activo: false } } })).status).toBe('sin_portal')
    expect(estadoVerificacion(base()).label).toBe('Verificado')
    expect(estadoVerificacion(base({ resumen: { ...base().resumen, portal: { tiene: true, verificado: false, activo: true } }, profesional: { ...base().profesional!, verification: { status: 'rejected' } } })).status).toBe('rejected')
  })
  it('línea de domicilio con municipio solo cuando difiere de la ciudad', () => {
    expect(lineaDomicilio({ line1: 'Av. 2', exterior_number: '10', interior_number: null, neighborhood: 'Centro', postal_code: '82100', city: 'Mazatlán', state: 'Sinaloa', municipio: 'Mazatlán' } as never)).toBe('Av. 2 #10, Centro, C.P. 82100, Mazatlán, Sinaloa')
    expect(lineaDomicilio({ line1: 'Calle', exterior_number: null, interior_number: null, neighborhood: null, postal_code: '06600', city: 'CDMX', state: 'CDMX', municipio: 'Cuauhtémoc' } as never)).toContain('Cuauhtémoc')
  })
})

describe('cliente de comandos', () => {
  it('cada comando manda SOLO su argumento (sin rol, vendedor, precio ni identidad del actor)', async () => {
    const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
    const c = new ClienteC360(async (fn, args) => { llamadas.push({ fn, args }); return { data: { id: 'x' }, error: null } })
    await c.leer('C'); await c.guardarTelefono(null, null, '669 1', 'whatsapp', true); await c.archivarTelefono('t'); await c.guardarDomicilio('C', null, { tipo: 'CASA' })
    await c.guardarFiscal(null, 'f', { rfc: 'X' }, true); await c.archivarFiscal('f'); await c.agregarNota('C', 'hola'); await c.adoptarAlta(null)
    expect(llamadas.map((l) => l.fn)).toEqual(['cliente_360', 'cliente_telefono_guardar', 'cliente_telefono_archivar', 'cliente_ubicacion_guardar', 'cliente_fiscal_guardar', 'cliente_fiscal_archivar', 'cliente_nota_agregar', 'cliente_ubicacion_adoptar_alta'])
    for (const l of llamadas) expect(JSON.stringify(l.args)).not.toMatch(/rol|seller|vendedor|precio|profile_id|auth/)
  })
  it('errores del servidor → mensajes claros, sin detalles internos', async () => {
    const c = new ClienteC360(async () => ({ data: null, error: { message: 'TELEFONO_DUPLICADO: ese número ya está registrado' } }))
    expect(await c.guardarTelefono(null, null, '669', 'otro')).toEqual({ ok: false, error: 'Ese número ya está registrado para este cliente.' })
    expect(mensajeError360('NO_AUTORIZADO: no puedes ver este cliente')).toMatch(/permiso/)
    expect(mensajeError360('FISCAL_INVALIDO: RFC requerido')).toBe('Datos fiscales: RFC requerido.')
    expect(mensajeError360('ERROR: relation x does not exist')).toBe('No se pudo completar. Intenta de nuevo.')
  })
})
