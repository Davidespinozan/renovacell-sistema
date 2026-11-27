// @vitest-environment jsdom
// SEC-C4-B5 · Nuevo pedido: DATOS FISCALES DEL PEDIDO ≠ PERFIL FISCAL PERMANENTE.
// Ventas captura el receptor solo para el pedido (sin leer ni escribir el expediente fiscal de la cuenta); el
// servidor lo congela en el pedido. Dirección conserva la precarga y la actualización del perfil. Datos falsos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { isFiscalProfileComplete, type FiscalProfile } from '../../data/ops/fiscal'
import fuente from './NuevoPedido.tsx?raw'
import fuentePedidos from '../../data/store/ordersStore.ts?raw'

const MAESTRO = { rfc: 'MAE010101AB1', razon_social: 'PERFIL PERMANENTE SA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'maestro@fiscal.test' }
const CAPTURA = { rfc: 'XAXX010101000', razon_social: 'CAPTURA DEL PEDIDO', regimen: '616', cp: '80010', uso_cfdi: 'S01', email_facturacion: 'captura@pedido.test' }

const h = vi.hoisted(() => ({
  role: 'pos', tablas: [] as string[], rpcs: [] as string[], expediente: null as unknown, errorSolicitud: null as null | { message: string }, upserts: [] as unknown[][], pedidos: [] as Array<Record<string, unknown>>,
  ancho: false, respuestaPedido: null as unknown, cola: [] as unknown[], diferido: null as null | { soltar: (v: unknown) => void }, respuestaUpsert: { ok: true } as { ok: boolean; error?: string }, maestro: null as unknown, captura: null as unknown,
}))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Lucía' } }) }))
vi.mock('../../app/useAnchoMinimo', () => ({ useAnchoMinimo: () => h.ancho }))   // computadora (true) o celular (false)
vi.mock('../../lib/supabase', () => {
  const cadena = (tabla: string) => { const c: Record<string, unknown> = {}; for (const k of ['select', 'eq']) c[k] = () => c; c.maybeSingle = async () => ({ data: tabla === 'customers' ? { id: 'CU-1', meta: { fiscal: h.maestro } } : null, error: null }); return c }
  return { hasSupabase: true, currentUserId: () => 'U-1', supabase: { from: (t: string) => { h.tablas.push(t); return cadena(t) }, rpc: async (fn: string) => { if (fn !== 'cliente_entrega_preferida') h.rpcs.push(fn); return { data: fn === 'cliente_perfiles_fiscales' ? h.expediente : fn === 'solicitar_cfdi' ? { status: 'applied' } : null, error: fn === 'solicitar_cfdi' ? h.errorSolicitud : null } } } }   // ENTREGA PREFERIDA (cliente_entrega_preferida) no es lectura fiscal
})
vi.mock('../../data/store/customersStore', () => ({
  customerFiscal: (c: { meta?: { fiscal?: unknown } } | null) => ({ rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: '', email_facturacion: '', ...((c?.meta?.fiscal as object) ?? {}) }),
  upsertCustomerFiscal: async (...a: unknown[]) => { h.upserts.push(a); return h.respuestaUpsert },
}))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'P1', name: 'Producto Uno', price: 100, sellable: true }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useVolumePrices', () => ({ useVolumePrices: () => ({ data: [] }) }))
vi.mock('../../data/ops/stock', () => ({ stockByProduct: () => ({}), stockInfoFor: () => ({ tracked: true, qty: 10, status: 'ok' }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useOrders: () => ({ createOrder: async (i: Record<string, unknown>) => {
  h.pedidos.push(i)
  if (h.diferido) return new Promise((res) => { h.diferido = { soltar: res } })
  return h.cola.length ? h.cola.shift() : h.respuestaPedido
} }) }))
// ENT-2 · el domicilio del cliente comercial y la entrega tienen sus propias pruebas (DomicilioClientePicker / SelectorEntrega);
// aquí se simulan: un domicilio elegido y la opción de entrega sugerida por el servidor.
vi.mock('../../app/DomicilioClientePicker', () => ({ DomicilioClientePicker: ({ onChange }: { onChange: (a: unknown) => void }) => <button type="button" onClick={() => onChange({ address: { line1: 'Calle 1', city: 'Culiacán', cp: '82000', phone: '6690000000' } })}>poner domicilio</button> }))
// COBRO-U · la forma de pago tiene sus propias pruebas (cobro.test / FormaDePago); aquí se elige efectivo.
vi.mock('../../app/FormaDePago', () => ({
  FormaDePago: ({ onChange }: { onChange: (c: unknown) => void }) => { React.useEffect(() => { onChange({ forma: 'efectivo' }) }, []); return <div data-testid="forma-pago" /> },   // eslint-disable-line react-hooks/exhaustive-deps
}))
vi.mock('../../app/SelectorEntrega', () => ({
  SelectorEntrega: ({ onChange }: { onChange: (e: unknown, ops: unknown) => void }) => { React.useEffect(() => { onChange({ opcion: 'foraneo_dhl' }, { corte: { hoy: '2026-10-21' }, opciones: [{ id: 'foraneo_dhl', tipo: 'foraneo', flete: 600, permitido: true, disponible: true, texto: 'DHL · sale hoy' }] }) }, []); return <div data-testid="sel-entrega" /> },   // eslint-disable-line react-hooks/exhaustive-deps
  eleccionCompleta: (v: unknown) => !!v,
}))
vi.mock('../../app/DeliveryLocationPicker', () => ({ DeliveryLocationPicker: ({ onChange }: { onChange: (a: unknown) => void }) => <button type="button" onClick={() => onChange({ address: { line1: 'Consultorio', city: 'Culiacán', phone: '' }, locationId: null })}>poner domicilio</button> }))
vi.mock('../../app/FiscalFields', () => ({
  FiscalFields: ({ onChange }: { onChange: (f: unknown) => void }) => <button type="button" data-testid="form-fiscal" onClick={() => onChange(h.captura)}>llenar fiscal</button>,
  FiscalSummary: ({ value }: { value: FiscalProfile }) => <div data-testid="resumen-fiscal">{value.rfc} {value.razon_social}</div>,
}))
import { NuevoPedido } from './NuevoPedido'

const CLIENTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Prueba', phone: null }
// 27 nov 2026 · La regla, precisa: Ventas NO lee la tabla de clientes ni recibe datos fiscales completos. Lo único que
// puede preguntar es `cliente_perfiles_fiscales`, la misma función del expediente, que a Ventas le contesta con el RFC
// ENMASCARADO. Cualquier otra llamada fiscal sigue prohibida.
const soloExpediente = () => h.rpcs.filter((x) => x !== 'cliente_perfiles_fiscales')
const CON_EXPEDIENTE = { customer_id: CLIENTE.id, puede_editar: false, perfiles: [{ id: 'PF-1', alias: 'Consultorio', rfc: 'GAP*******5K2', es_predeterminado: true }] }
const exito = (extra: object = {}) => ({ ok: true, order: { external_ref: 'S1001' }, ...extra })
const montar = (props: Partial<React.ComponentProps<typeof NuevoPedido>> = {}) => render(<NuevoPedido customer={CLIENTE} placedBy="Lucía (Ventas)" onClose={() => {}} {...props} />)
// PEDIDO POR PASOS (27 nov 2026) · productos, entrega y pago van en tres pantallas (las tres siguen montadas). Los
// helpers avanzan como la persona: «Continuar» hasta el botón final. Si un paso no deja avanzar, el botón apagado ES
// ese «Continuar» (mismo significado que antes: no se puede crear el pedido).
const alFinal = () => { for (let i = 0; i < 2; i++) { const c = screen.queryByTestId('np-continuar') as HTMLButtonElement | null; if (c && !c.disabled) fireEvent.click(c) } }
const boton = () => { alFinal(); return (screen.queryByRole('button', { name: /crear pedido|creando|guardando|reintentar envío/i }) ?? screen.getByTestId('np-continuar')) as HTMLButtonElement }
const armar = () => { fireEvent.click(screen.getAllByRole('button', { hidden: true }).filter((b) => b.className === 'btn sm')[0]); fireEvent.click(screen.getByText('poner domicilio')) }
const pedirFactura = () => fireEvent.click(screen.getAllByRole('checkbox', { hidden: true }).find((c) => !c.closest('[data-testid="np-entrega-preferida"]'))!)
const alerta = vi.fn()

beforeEach(() => {
  cleanup(); h.ancho = false; h.role = 'pos'; h.tablas = []; h.rpcs = []; h.expediente = null; h.errorSolicitud = null; h.upserts = []; h.pedidos = []; h.respuestaPedido = exito(); h.cola = []; h.diferido = null; h.respuestaUpsert = { ok: true }
  h.maestro = MAESTRO; h.captura = CAPTURA; alerta.mockReset(); window.alert = alerta
})

describe('SEC-C4-B5 · Ventas · pedido sin factura', () => {
  it('crea el pedido con identificador y nombre de la cuenta; sin lecturas ni escrituras del expediente', async () => {
    montar(); armar()
    expect(screen.getByTestId('np-total')).toHaveTextContent(/700/)   // ENT-2 · 100 + flete 600 que propone el servidor
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos).toHaveLength(1)
    const p = h.pedidos[0]
    expect(p.customer_id).toBe(CLIENTE.id); expect(p.customer).toEqual({ name: 'Ana Prueba', phone: null })
    expect(p.invoice_requested).toBe(false); expect(p.receiver).toBeNull(); expect(p.placedBy).toBe('Lucía (Ventas)')
    expect(p).not.toHaveProperty('doctor_id'); expect(p).not.toHaveProperty('seller'); expect(p).not.toHaveProperty('seller_id')
    expect(p.lines).toEqual([{ product_id: 'P1', qty: 1, unit_price: 100 }])
    expect(p.entrega).toEqual({ opcion: 'foraneo_dhl' })   // ENT-2 · la entrega viaja con el pedido (solo el id de la opción)
    expect(h.tablas).toEqual([]); expect(soloExpediente()).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('rechazo del servidor: se muestra y NO se anuncia éxito', async () => {
    h.respuestaPedido = { ok: false, error: 'No tienes permiso para levantar este pedido.', ambiguous: false }
    montar(); armar()
    fireEvent.click(boton())
    expect(await screen.findByRole('alert')).toHaveTextContent('El pedido no se creó. No tienes permiso')
    expect(screen.queryByText('Pedido creado')).toBeNull()
    expect(h.pedidos).toHaveLength(1)                       // sin reintento automático
  })
  it('sin productos o sin domicilio no hay solicitud', () => {
    montar()
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(0)
  })
})

describe('SEC-C4-B5 · Ventas · pedido con factura (captura solo para el pedido)', () => {
  it('pedir factura NO consulta el perfil fiscal de la cuenta: formulario en blanco y aviso', async () => {
    montar(); armar(); pedirFactura()
    expect(await screen.findByTestId('form-fiscal')).toBeTruthy()
    expect(screen.getByTestId('np-fiscal-solo-pedido')).toHaveTextContent('solo en este pedido')
    expect(screen.getByText('Datos fiscales para este pedido')).toBeTruthy()
    expect(h.tablas).toEqual([]); expect(soloExpediente()).toEqual([])
    const t = document.body.textContent ?? ''
    for (const s of [MAESTRO.rfc, MAESTRO.razon_social, MAESTRO.email_facturacion]) expect(t).not.toContain(s)
    expect(screen.queryByTestId('resumen-fiscal')).toBeNull(); expect(screen.queryByText('Editar')).toBeNull()
  })
  it('validación fiscal conservada: incompleto no crea el pedido', async () => {
    montar(); armar(); pedirFactura()
    await screen.findByTestId('form-fiscal')
    expect(boton().disabled).toBe(true)
    h.captura = { ...CAPTURA, rfc: 'MAL' }
    fireEvent.click(screen.getByTestId('form-fiscal'))
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(0)
  })
  it('captura completa: el receptor viaja SOLO en el pedido; el perfil permanente no se escribe', async () => {
    expect(isFiscalProfileComplete(CAPTURA)).toBe(true)
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([])                           // NO upsert_customer_fiscal
    expect(h.tablas).toEqual([]); expect(soloExpediente()).toEqual([])
    expect(h.pedidos[0].invoice_requested).toBe(true); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
    expect(h.pedidos[0].customer_id).toBe(CLIENTE.id)
    expect(screen.queryByTestId('np-fiscal-pendiente')).toBeNull()
  })
  it('FISCAL-3-FE · ya no existe el estado "pedido creado sin receptor" en la pantalla', () => {
    expect(fuente).not.toMatch(/fiscalPendiente|np-fiscal-pendiente|NO quedaron guardados/)
  })
  it('rechazo del servidor con factura: sin éxito y sin escritura alterna', async () => {
    h.respuestaPedido = { ok: false, error: 'NO_AUTORIZADO', ambiguous: false }
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    fireEvent.click(boton())
    expect(await screen.findByRole('alert')).toHaveTextContent('El pedido no se creó')
    expect(h.upserts).toEqual([]); expect(soloExpediente()).toEqual([]); expect(h.pedidos).toHaveLength(1)
  })
  it('otra cuenta (pantalla nueva): no arrastra los datos fiscales capturados para la anterior', async () => {
    const a = montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    a.unmount()
    montar({ customer: { id: '22222222-2222-4222-8222-222222222222', name: 'Beto Otro', phone: null } }); armar(); pedirFactura()
    await screen.findByTestId('form-fiscal')
    expect(boton().disabled).toBe(true)                     // en blanco otra vez
    expect(h.pedidos).toHaveLength(0)
  })
  it('otros roles sin permiso fiscal: mismo trato que Ventas (ni lectura ni escritura)', async () => {
    for (const rol of ['warehouse', 'driver', 'doctor']) {
      cleanup(); h.role = rol; h.tablas = []; h.upserts = []
      Object.keys(localStorage).filter((k) => k.startsWith('rc_borrador:')).forEach((k) => localStorage.removeItem(k))   // BORRADORES · cada vuelta es una pantalla nueva
      montar(); armar(); pedirFactura()
      await screen.findByTestId('form-fiscal')
      expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
    }
  })
})

describe('SEC-C4-B5 · Dirección conserva su flujo', () => {
  beforeEach(() => { h.role = 'admin' })
  it('precarga el perfil permanente y lo usa como receptor sin reescribirlo', async () => {
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    expect(await screen.findByTestId('resumen-fiscal')).toHaveTextContent(MAESTRO.rfc)
    expect(h.tablas).toEqual(['customers'])
    expect(screen.getByText('Datos fiscales del cliente')).toBeTruthy(); expect(screen.queryByTestId('np-fiscal-solo-pedido')).toBeNull()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([]); expect(h.pedidos[0].receiver).toEqual(MAESTRO)
  })
  it('editar: actualiza el perfil permanente de ESA cuenta y luego crea el pedido', async () => {
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    await screen.findByTestId('resumen-fiscal')
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([[CLIENTE.id, CAPTURA]]); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
  })
  it('si el perfil permanente no se pudo guardar, el pedido NO se crea', async () => {
    h.respuestaUpsert = { ok: false, error: 'FISCAL_INVALIDO' }
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    await screen.findByTestId('resumen-fiscal')
    fireEvent.click(screen.getByText('Editar')); fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(boton())
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('FISCAL_INVALIDO'))
    expect(h.pedidos).toHaveLength(0); expect(screen.queryByText('Pedido creado')).toBeNull()
  })
  it('pedido a nombre de un doctor: sin cambios (precarga por perfil, doctor_id)', async () => {
    render(<NuevoPedido doctor={{ id: '33333333-3333-4333-8333-333333333333', name: 'Dra. Portal' }} placedBy="Administración" onClose={() => {}} />)
    armar(); pedirFactura()
    expect(await screen.findByTestId('resumen-fiscal')).toHaveTextContent(MAESTRO.rfc)
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[0].doctor_id).toBe('33333333-3333-4333-8333-333333333333'); expect(h.pedidos[0]).not.toHaveProperty('customer_id')
  })
})

describe('SEC-C4-B5 · guardas de fuente', () => {
  const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  it('lecturas y escritura del perfil permanente quedan detrás de Dirección; sin directorio, consola ni almacenamiento', () => {
    const c = codigo(fuente)
    expect(c).toMatch(/const fiscalPermanente = role === 'admin'/)
    expect(c).toMatch(/if \(invoice && fiscalPermanente && fiscalCustomerId && editingFiscal\)/)
    expect(c.indexOf('if (!fiscalPermanente) {')).toBeGreaterThan(0)
    expect(c.indexOf('if (!fiscalPermanente) {')).toBeLessThan(c.indexOf(".from('customers')"))
    expect(c.match(/upsertCustomerFiscal\(/g)).toHaveLength(1)
    for (const p of [/useCustomers|listCustomers/, /service_role/, /console\./, /localStorage|sessionStorage/, /cliente_fiscal_guardar|customer_fiscal_profiles/]) expect(c).not.toMatch(p)
  })
  it('FISCAL-3 · con factura, pedido y receptor en UNA llamada; sin segunda escritura del receptor', () => {
    const p = codigo(fuentePedidos)
    const alta = p.slice(p.indexOf('export async function createOrder'), p.indexOf('const CANCELABLE'))
    expect(alta).toMatch(/supabase\.rpc\('crear_pedido_con_receptor'/)
    expect(alta).not.toMatch(/set_order_fiscal_snapshot|fiscalPendiente/)
    expect(p).not.toMatch(/upsert_customer_fiscal/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-C4-FISCAL-3-FE · una operación = un identificador; reintentos sin duplicar; estados claros.
// ─────────────────────────────────────────────────────────────────────────────
describe('SEC-C4-FISCAL-3-FE · operación, reintentos y estados', () => {
  const conFacturaLista = async () => { montar(); armar(); pedirFactura(); fireEvent.click(await screen.findByTestId('form-fiscal')); await waitFor(() => expect(boton().disabled).toBe(false)) }
  const op = (i: number) => h.pedidos[i].operacion as { id: string; folio: string }
  const incierto = { ok: false, error: 'No se pudo confirmar si el pedido quedó registrado. Reintenta: se reenvía el MISMO pedido y el servidor no lo duplica.', ambiguous: true, motivo: 'incierto', incierto: true }

  it('con factura: una sola solicitud con operación estable y el receptor del pedido', async () => {
    await conFacturaLista()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos).toHaveLength(1)
    expect(op(0).id).toMatch(/^[0-9a-f-]{36}$/); expect(op(0).folio).toMatch(/^S\d{6}$/)
    expect(h.pedidos[0].invoice_requested).toBe(true); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
    expect(soloExpediente()).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('doble clic: una sola solicitud', async () => {
    h.diferido = { soltar: () => {} }
    await conFacturaLista()
    fireEvent.click(boton()); fireEvent.click(boton()); fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(1)
    await waitFor(() => expect(boton().textContent).toMatch(/Creando pedido/))
    h.diferido!.soltar(exito()); h.diferido = null
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos).toHaveLength(1)
  })
  it('timeout: no afirma que no existe; el reintento reenvía la MISMA operación y el mismo contenido', async () => {
    h.cola = [incierto, exito({ repetido: true })]
    await conFacturaLista()
    fireEvent.click(boton())
    const a = await screen.findByTestId('np-error-incierto')
    expect(a).toHaveTextContent('No se pudo confirmar el pedido'); expect(a).not.toHaveTextContent('no se creó')
    expect(boton().textContent).toBe('Reintentar envío')
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido confirmado')).toBeTruthy())
    expect(screen.getByTestId('np-repetido')).toHaveTextContent('no se creó otro')
    expect(h.pedidos).toHaveLength(2)
    expect(op(1)).toEqual(op(0))
    const { operacion: _a, ...s0 } = h.pedidos[0]; const { operacion: _b, ...s1 } = h.pedidos[1]
    expect(s1).toEqual(s0)
  })
  it('timeout y luego el usuario cambia productos: se avisa y se reenvía el ORIGINAL (nunca un id nuevo)', async () => {
    h.cola = [incierto, incierto]
    await conFacturaLista()
    fireEvent.click(boton())
    await screen.findByTestId('np-error-incierto')
    fireEvent.click(screen.getAllByRole('button', { hidden: true }).filter((b) => b.className === 'btn sm')[0])   // +1 unidad
    expect(await screen.findByTestId('np-reenvio-original')).toHaveTextContent('pedido ORIGINAL')
    fireEvent.click(boton())
    await waitFor(() => expect(h.pedidos).toHaveLength(2))
    expect(op(1)).toEqual(op(0)); expect(h.pedidos[1].lines).toEqual(h.pedidos[0].lines)
  })
  it('timeout y luego el usuario cambia el receptor: también se reenvía el original', async () => {
    h.cola = [incierto, exito({ repetido: true })]
    await conFacturaLista()
    fireEvent.click(boton())
    await screen.findByTestId('np-error-incierto')
    h.captura = { ...CAPTURA, rfc: 'BBB010101BB2' }; fireEvent.click(screen.getByTestId('form-fiscal'))
    await screen.findByTestId('np-reenvio-original')
    fireEvent.click(boton())
    await waitFor(() => expect(h.pedidos).toHaveLength(2))
    expect(h.pedidos[1].receiver).toEqual(CAPTURA); expect(op(1)).toEqual(op(0))
  })
  it('conflicto: se muestra, no es éxito y no se puede eludir con otro identificador', async () => {
    h.respuestaPedido = { ok: false, error: 'Ese envío no coincide con el pedido que ya quedó registrado con este identificador.', ambiguous: false, motivo: 'conflicto' }
    await conFacturaLista()
    fireEvent.click(boton())
    expect(await screen.findByTestId('np-error-conflicto')).toHaveTextContent('No se creó un pedido nuevo')
    expect(screen.queryByText('Pedido creado')).toBeNull()
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(1)
  })
  it('receptor rechazado por el servidor: se reabre el formulario conservando lo capturado; el nuevo envío es otra operación', async () => {
    h.cola = [{ ok: false, error: 'Los datos fiscales no son válidos.', ambiguous: false, motivo: 'fiscal' }, exito()]
    await conFacturaLista()
    fireEvent.click(boton())
    expect(await screen.findByTestId('np-error-fiscal')).toHaveTextContent('revisa los datos fiscales')
    expect(screen.getByTestId('form-fiscal')).toBeTruthy()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[1].receiver).toEqual(CAPTURA); expect(op(1).id).not.toBe(op(0).id)
  })
  it('sesión expirada: mismo identificador al reintentar lo mismo; el carrito y el receptor se conservan', async () => {
    h.cola = [{ ok: false, error: 'Tu sesión expiró.', ambiguous: false, motivo: 'autorizacion' }, exito()]
    await conFacturaLista()
    fireEvent.click(boton())
    expect(await screen.findByTestId('np-error-autorizacion')).toHaveTextContent('El pedido no se creó')
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(op(1)).toEqual(op(0)); expect(h.pedidos[1].receiver).toEqual(CAPTURA)
  })
  it('rechazo y luego cambio de contenido: operación nueva (no se reutiliza el id para otra solicitud)', async () => {
    h.cola = [{ ok: false, error: 'Ese producto ya no se vende.', ambiguous: false, motivo: 'rechazo' }, exito()]
    montar(); armar()
    fireEvent.click(boton())
    await screen.findByTestId('np-error-rechazo')
    fireEvent.click(screen.getAllByRole('button', { hidden: true }).filter((b) => b.className === 'btn sm')[0])
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(op(1).id).not.toBe(op(0).id)
  })
  it('sin factura: sin receptor y con operación propia; activar y desactivar factura no arrastra el receptor', async () => {
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    pedirFactura()                                         // la quita
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[0].invoice_requested).toBe(false); expect(h.pedidos[0].receiver).toBeNull()
    expect(op(0).id).toBeTruthy()
  })
  it('Dirección con varios intentos: el perfil permanente se actualiza una vez; el reenvío incierto no lo vuelve a escribir', async () => {
    h.role = 'admin'; h.cola = [incierto, exito({ repetido: true })]
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    await screen.findByTestId('resumen-fiscal')
    fireEvent.click(screen.getByText('Editar')); fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(boton())
    await screen.findByTestId('np-error-incierto')
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido confirmado')).toBeTruthy())
    expect(h.upserts).toEqual([[CLIENTE.id, CAPTURA]]); expect(op(1)).toEqual(op(0))
  })
})

// PEDIDO POR PASOS (27 nov 2026, «sistema sencillo por rol») · una pregunta por pantalla y un botón que dice qué falta.
describe('Levantar pedido · por pasos', () => {
  const visible = (id: string) => !(screen.getByTestId(id) as HTMLElement).hidden
  it('empieza en Productos; sin productos no se avanza y dice qué falta', () => {
    montar()
    expect(visible('np-paso-1')).toBe(true); expect(visible('np-paso-2')).toBe(false); expect(visible('np-paso-3')).toBe(false)
    expect(screen.getByTestId('np-falta')).toHaveTextContent('Agrega al menos un producto.')
    expect((screen.getByTestId('np-continuar') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('np-continuar')).toHaveTextContent('Continuar a entrega')
    expect(screen.queryByRole('button', { name: /crear pedido/i })).toBeNull()
  })
  it('con un producto pasa a Entrega; sin dirección no pasa a Pago y lo dice', () => {
    montar()
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.className === 'btn sm')[0])
    expect(screen.queryByTestId('np-falta')).toBeNull()
    fireEvent.click(screen.getByTestId('np-continuar'))
    expect(visible('np-paso-1')).toBe(false); expect(visible('np-paso-2')).toBe(true)
    expect(screen.getByTestId('np-falta')).toHaveTextContent('Falta la dirección de entrega.')
    expect((screen.getByTestId('np-continuar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('poner domicilio'))
    expect((screen.getByTestId('np-continuar') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('np-continuar'))
    expect(visible('np-paso-3')).toBe(true)
    expect(screen.getByRole('button', { name: /crear pedido/i })).toBeTruthy()
  })
  it('«Atrás» regresa un paso sin perder lo capturado', () => {
    montar(); armar(); boton()
    expect(visible('np-paso-3')).toBe(true)
    fireEvent.click(screen.getByTestId('np-atras'))
    expect(visible('np-paso-2')).toBe(true)
    fireEvent.click(screen.getByTestId('np-atras'))
    expect(visible('np-paso-1')).toBe(true)
    expect((screen.getByTestId('np-cantidad') as HTMLInputElement).value).toBe('1')
    expect(screen.getByText('Cancelar')).toBeTruthy()   // en el primer paso el botón de la izquierda cierra
  })
  it('la cantidad se puede escribir; respeta la existencia y vacía quita el producto', async () => {
    montar(); armar()
    const cant = () => screen.getByTestId('np-cantidad') as HTMLInputElement
    fireEvent.change(cant(), { target: { value: '7' } })
    expect(cant().value).toBe('7')
    fireEvent.change(cant(), { target: { value: '25' } })      // hay 10 en existencia
    expect(cant().value).toBe('10')
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[0].lines).toEqual([{ product_id: 'P1', qty: 10, unit_price: 100 }])
  })
  it('escribir 0 quita el producto y vuelve a pedir uno', () => {
    montar(); armar()
    fireEvent.change(screen.getByTestId('np-cantidad'), { target: { value: '0' } })
    expect(screen.queryByTestId('np-cantidad')).toBeNull()
    expect(screen.getByTestId('np-falta')).toHaveTextContent('Agrega al menos un producto.')
  })
  it('el encabezado dice en qué paso va y deja regresar a uno ya hecho', () => {
    montar(); armar(); boton()
    const pasos = screen.getByTestId('np-pasos')
    expect(pasos.getAttribute('aria-label')).toBe('Paso 4 de 4')
    fireEvent.click(screen.getByRole('button', { name: 'Productos' }))
    expect(visible('np-paso-1')).toBe(true)
    expect(pasos.getAttribute('aria-label')).toBe('Paso 2 de 4')
  })
})

describe('Levantar pedido · resumen al lado (computadora)', () => {
  it('en computadora el resumen acompaña los pasos: cliente, productos, entrega, pago y total', () => {
    h.ancho = true
    montar()
    const lado = screen.getByTestId('np-lado')
    expect(lado).toHaveTextContent('Resumen del pedido'); expect(lado).toHaveTextContent('Ana Prueba')
    expect(screen.getByTestId('np-lado-productos')).toHaveTextContent('Todavía ninguno')
    armar()
    expect(screen.getByTestId('np-lado-productos')).toHaveTextContent('Producto Uno')
    expect(screen.getByTestId('np-lado-entrega')).toHaveTextContent('DHL')        // la que propone el servidor
    expect(screen.getByTestId('np-lado-pago')).toHaveTextContent('Efectivo')
    expect(lado).toHaveTextContent('$700')                                        // 100 + flete 600
  })
  it('en el celular y junto al chat no hay resumen al lado: el total sigue en el pie', () => {
    montar()
    expect(screen.queryByTestId('np-lado')).toBeNull()
    cleanup(); h.ancho = true
    montar({ acoplado: true })
    expect(screen.queryByTestId('np-lado')).toBeNull()
  })
  it('el resumen solo muestra: el pedido se crea con lo mismo', async () => {
    h.ancho = true
    montar(); armar()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[0].lines).toEqual([{ product_id: 'P1', qty: 1, unit_price: 100 }])
    expect(screen.queryByTestId('np-lado')).toBeNull()                            // ya creado, no hace falta
  })
})

// DATOS FISCALES DEL EXPEDIENTE (27 nov 2026, dueño: «al solicitar factura en los puntos de venta no se llena, a pesar de
// que muchos clientes ya tienen información fiscal en su expediente»). Ventas no ve los datos completos; el servidor los
// pone al pedir la factura sin receptor.
describe('Ventas · el cliente ya tiene datos fiscales en su expediente', () => {
  it('lo avisa con el RFC enmascarado y NO muestra el formulario; nunca lee la tabla de clientes', async () => {
    h.expediente = CON_EXPEDIENTE
    montar(); armar(); pedirFactura()
    const aviso = await screen.findByTestId('np-fiscal-expediente')
    expect(aviso).toHaveTextContent('Este cliente ya tiene datos fiscales en su expediente'); expect(aviso).toHaveTextContent('GAP*******5K2')
    expect(screen.queryByTestId('form-fiscal')).toBeNull()
    expect(screen.getByTestId('np-fiscal-expediente-nota')).toHaveTextContent('no hay que volver a escribirlos')
    expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual(['cliente_perfiles_fiscales']); expect(h.upserts).toEqual([])
  })
  it('crea el pedido SIN receptor y enseguida pide la factura: el servidor pone los datos del expediente', async () => {
    h.expediente = CON_EXPEDIENTE; h.respuestaPedido = exito({ order: { id: 'O-1', external_ref: 'S1001' } })
    montar(); armar(); pedirFactura()
    await screen.findByTestId('np-fiscal-expediente')
    fireEvent.click(boton())
    expect(await screen.findByTestId('np-factura-expediente')).toHaveTextContent('Factura pedida con los datos fiscales de su expediente.')
    expect(h.pedidos).toHaveLength(1)
    expect(h.pedidos[0].invoice_requested).toBe(false); expect(h.pedidos[0].receiver).toBeNull()   // ningún dato fiscal viaja desde la pantalla
    expect(h.rpcs).toEqual(['cliente_perfiles_fiscales', 'solicitar_cfdi']); expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('si la factura no se pudo pedir, dice que el pedido SÍ se creó y por qué no quedó la factura', async () => {
    h.expediente = CON_EXPEDIENTE; h.respuestaPedido = exito({ order: { id: 'O-1', external_ref: 'S1001' } }); h.errorSolicitud = { message: 'DATOS_FISCALES_REQUERIDOS: incompletos' }
    montar(); armar(); pedirFactura()
    await screen.findByTestId('np-fiscal-expediente')
    fireEvent.click(boton())
    const a = await screen.findByTestId('np-factura-expediente')
    expect(a).toHaveTextContent('El pedido SÍ se creó, pero la factura no quedó pedida'); expect(a).toHaveTextContent('Pídela desde Facturación')
    expect(h.pedidos).toHaveLength(1)
  })
  it('«Capturar otros datos» regresa al formulario y el pedido viaja con lo capturado, como siempre', async () => {
    h.expediente = CON_EXPEDIENTE
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('np-fiscal-expediente-otros'))
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    fireEvent.click(boton())
    await waitFor(() => expect(h.pedidos).toHaveLength(1))
    expect(h.pedidos[0].invoice_requested).toBe(true); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
    expect(h.rpcs).toEqual(['cliente_perfiles_fiscales'])                                          // no se pide por el expediente
  })
  it('sin datos en el expediente, o si la consulta falla: formulario en blanco, igual que antes', async () => {
    h.expediente = { customer_id: CLIENTE.id, puede_editar: false, perfiles: [] }
    montar(); armar(); pedirFactura()
    expect(await screen.findByTestId('form-fiscal')).toBeTruthy(); expect(screen.queryByTestId('np-fiscal-expediente')).toBeNull()
  })
})
