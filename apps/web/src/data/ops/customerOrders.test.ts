// FASE 2 customers — pedidos/POS customer-only. Data layer (mock) + garantías DB (RPC ?raw) +
// resolución de nombre downstream + estructura de UI. Comportamiento SQL real = self-test de la
// migración + E2E autenticado (aparte).
import { describe, it, expect } from 'vitest'
import { createOrder, createPosOrder } from '../store/ordersStore'
import { orderClientName, customerSnapshot } from './orderClient'
import migSrc from '../../../../../supabase/migrations/20260923120000_customer_orders_rpc.sql?raw'
import posSrc from './pos.ts?raw'
import ordersRaw from '../store/ordersStore.ts?raw'
import nuevoPedidoSrc from '../../screens/sales/NuevoPedido.tsx?raw'
import cajaSrc from '../../screens/pos/Caja.tsx?raw'

const lines = [{ product_id: 'p1', qty: 2, unit_price: 100 }]

describe('createOrder — customer-only vs legacy doctor', () => {
  it('customer-only: doctor_id NULL, customer_id set, snapshot en shipping_meta.customer', () => {
    const o = createOrder({ lines, total: 200, invoice_requested: false, customer_id: 'cust-1', customer: { name: 'Dra. Ana', phone: '55' }, shipping: { line1: 'Calle 1', city: 'CDMX' }, placedBy: 'Ventas' })
    expect(o.doctor_id).toBeNull()
    expect(o.customer_id).toBe('cust-1')
    const snap = customerSnapshot(o.shipping_meta)
    expect(snap?.name).toBe('Dra. Ana')
    expect(snap?.id).toBe('cust-1')
    expect((o.shipping_meta as { address?: unknown }).address).toEqual({ line1: 'Calle 1', city: 'CDMX' })
  })
  it('legacy doctor sigue funcionando (doctor_id set, customer_id null)', () => {
    const o = createOrder({ lines, total: 200, invoice_requested: false, doctor_id: 'doc-1', shipping: { line1: 'X', city: 'Y' } })
    expect(o.doctor_id).toBe('doc-1')
    expect(o.customer_id).toBeNull()
    expect(customerSnapshot(o.shipping_meta)).toBeNull()
  })
  it('createPosOrder customer: snapshot en shipping_meta.customer; mostrador anónimo sin customer', () => {
    const withCust = createPosOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100, lot_id: null }], total: 100, payment_method: 'efectivo', customer_id: 'cust-2', customer: { name: 'Dr. Beto' } }, true)
    expect(withCust.customer_id).toBe('cust-2')
    expect(customerSnapshot(withCust.shipping_meta)?.name).toBe('Dr. Beto')
    const mostrador = createPosOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100, lot_id: null }], total: 100, payment_method: 'efectivo' }, true)
    expect(mostrador.customer_id).toBeNull()
    expect(customerSnapshot(mostrador.shipping_meta)).toBeNull()
  })
})

describe('orderClientName — snapshot → doctor → fallback (sin N+1)', () => {
  it('usa el snapshot del customer si existe', () => {
    expect(orderClientName({ doctor_id: null, shipping_meta: { customer: { id: 'c', name: 'Dra. Ana' } } }, () => 'IGNORAR')).toBe('Dra. Ana')
  })
  it('cae al doctor legacy si no hay snapshot', () => {
    expect(orderClientName({ doctor_id: 'doc-1', shipping_meta: null }, (id) => (id === 'doc-1' ? 'Dr. Legacy' : null))).toBe('Dr. Legacy')
  })
  it('fallback cuando no hay ni snapshot ni doctor', () => {
    expect(orderClientName({ doctor_id: null, shipping_meta: {} }, () => null, 'Mostrador')).toBe('Mostrador')
  })
})

describe('garantías DB — RPC crear_pedido / vender_pos (migración)', () => {
  it('crear_pedido: p_customer_id + guard FALTA_IDENTIDAD + validación CUSTOMER_INEXISTENTE', () => {
    expect(migSrc).toMatch(/create or replace function public\.crear_pedido\([^)]*p_customer_id\s+uuid\s+default null/s)
    expect(migSrc).toMatch(/if p_doctor_id is null and p_customer_id is null then/)
    expect(migSrc).toMatch(/FALTA_IDENTIDAD/)
    expect(migSrc).toMatch(/from public\.customers where id = p_customer_id and active = true/)
    expect(migSrc).toMatch(/CUSTOMER_INEXISTENTE/)
  })
  it('crear_pedido: precio base cuando no hay doctor (lista solo si p_doctor_id no es null)', () => {
    expect(migSrc).toMatch(/if p_doctor_id is not null then\s*select price_list_id into list/)
  })
  it('snapshot server-side del customer en shipping_meta', () => {
    expect(migSrc).toMatch(/jsonb_set\(coalesce\(v_meta, '\{\}'::jsonb\), '\{customer\}'/)
  })
  it('vender_pos: p_customer_id, permite mostrador anónimo (sin FALTA_IDENTIDAD)', () => {
    expect(migSrc).toMatch(/create or replace function public\.vender_pos\([^$]*p_customer_id\s+uuid default null/s)
    // FALTA_IDENTIDAD aparece SOLO en crear_pedido (mostrador anónimo sigue permitido en POS)
    expect((migSrc.match(/FALTA_IDENTIDAD/g) ?? []).length).toBe(1)
  })
  it('DROP controlado de firmas viejas (evita overload ambiguo) + grants a authenticated', () => {
    expect(migSrc).toMatch(/drop function if exists public\.crear_pedido\(uuid, text, uuid, jsonb, jsonb, boolean\)/)
    expect(migSrc).toMatch(/drop function if exists public\.vender_pos\(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb\)/)
    expect(migSrc).toMatch(/grant execute on function public\.crear_pedido\(uuid, text, uuid, jsonb, jsonb, boolean, uuid\) to authenticated/)
    expect(migSrc).toMatch(/grant execute on function public\.vender_pos\([^)]*, uuid\) to authenticated/)
  })
  it('precio server-side intacto: usa precio_de, nunca precio del cliente', () => {
    expect(migSrc).toMatch(/up := public\.precio_de\(pid, list\)/)
    expect(migSrc).toMatch(/up := public\.precio_de\(pid, null\)/)
  })
})

describe('data layer / UI pasan customer_id a las RPC', () => {
  it('ordersStore.createOrder pasa p_customer_id a crear_pedido (customer explícito o resuelto del doctor)', () => {
    // Customer 360: el pedido Portal del doctor lleva customer_id resuelto por profile_id.
    expect(ordersRaw).toMatch(/p_customer_id: resolvedCustomerId/)
    expect(ordersRaw).toMatch(/from\('customers'\)\.select\('id'\)\.eq\('profile_id', doctorId/)
  })
  it('pos.ts pasa p_customer_id a vender_pos', () => {
    expect(posSrc).toMatch(/p_customer_id: \(isUuid\(opts\.customerId\)/)
  })
  it('NuevoPedido soporta customer (prop customer + AddressPicker one-off)', () => {
    expect(nuevoPedidoSrc).toMatch(/customer\?: \{ id: string; name: string/)
    expect(nuevoPedidoSrc).toMatch(/AddressPicker/)
  })
  it('Caja ClientPicker usa customers (directorio comercial)', () => {
    expect(cajaSrc).toMatch(/useCustomers/)
    expect(cajaSrc).toMatch(/customers=\{allCustomers\}/)
  })
})
