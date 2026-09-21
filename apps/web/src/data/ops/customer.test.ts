// Customer domain — helpers puros + garantías DB (migración) + no-contaminación (store).
// Las conductas de RLS/constraints son a nivel DB (no ejecutables en vitest): se aseguran contra
// el texto de la migración y el self-test que corre al aplicarla (E2E autenticado aparte).
import { describe, it, expect } from 'vitest'
import { normalizeEmail, normalizePhone, computeImportHash, classifyImportRow, type Customer } from './customer'
import { createOrder, createPosOrder } from '../store/ordersStore'
import migSrc from '../../../../../supabase/migrations/20260922120000_customers_domain.sql?raw'
import storeSrc from '../store/customersStore.ts?raw'

const mkCustomer = (o: Partial<Customer> = {}): Customer => ({
  id: 'c1', full_name: 'Dra. Ana', email: null, phone: null, city: null, country: null,
  seller_name: null, external_id: null, source: null, import_hash: null, profile_id: null,
  meta: {}, active: true, created_at: 'T0', updated_at: 'T0', ...o,
})

describe('identidad — normalización (nunca inventa)', () => {
  it('normalizeEmail: minúsculas, válido o null', () => {
    expect(normalizeEmail('  Dra@Clinica.MX ')).toBe('dra@clinica.mx')
    expect(normalizeEmail('no-es-email')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
  it('normalizePhone: solo dígitos, ≥10 o null', () => {
    expect(normalizePhone('(667) 123-4567')).toBe('6671234567')
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('import_hash idempotente y determinista', () => {
  it('mismos datos → misma huella (independiente de formato/orden de captura)', () => {
    const a = computeImportHash({ full_name: 'Dra. Ana', email: 'ANA@x.com', phone: '(667) 123 4567', city: 'Culiacán', seller_name: 'Roberto' })
    const b = computeImportHash({ full_name: 'dra. ana', email: 'ana@x.com', phone: '6671234567', city: 'culiacan', seller_name: 'roberto' })
    expect(a).toBe(b)
  })
  it('datos distintos → huellas distintas', () => {
    expect(computeImportHash({ full_name: 'Ana' })).not.toBe(computeImportHash({ full_name: 'Beto' }))
  })
})

describe('classifyImportRow — estados incrementales (no sobrescribe en silencio)', () => {
  it('sin nombre → INVALIDO', () => {
    expect(classifyImportRow({ full_name: '' }, null)).toBe('INVALIDO')
  })
  it('no existe → NUEVO', () => {
    expect(classifyImportRow({ full_name: 'Ana', email: 'a@x.com' }, null)).toBe('NUEVO')
  })
  it('existe y coincide (o import no aporta) → YA_EXISTE', () => {
    expect(classifyImportRow({ full_name: 'Ana', email: 'a@x.com' }, mkCustomer({ email: 'a@x.com' }))).toBe('YA_EXISTE')
    expect(classifyImportRow({ full_name: 'Ana' }, mkCustomer({ email: 'a@x.com' }))).toBe('YA_EXISTE')
  })
  it('DB vacío + import trae → ACTUALIZABLE', () => {
    expect(classifyImportRow({ full_name: 'Ana', phone: '6671234567', city: 'Culiacán' }, mkCustomer({ phone: null, city: null }))).toBe('ACTUALIZABLE')
  })
  it('ambos con valor distinto → CONFLICTO (no sobrescribe)', () => {
    expect(classifyImportRow({ full_name: 'Ana', email: 'nuevo@x.com' }, mkCustomer({ email: 'viejo@x.com' }))).toBe('CONFLICTO')
  })
})

describe('garantías DB — tabla customers (migración)', () => {
  it('crea customers SIN unique global en email/phone', () => {
    expect(migSrc).toMatch(/create table if not exists public\.customers/)
    // ningún índice único sobre (email) o (phone) por sí solos
    expect(migSrc).not.toMatch(/unique index[^\n]*customers\(email\)/i)
    expect(migSrc).not.toMatch(/unique index[^\n]*customers\(phone\)/i)
  })
  it('idempotencia por fuente: (source, external_id) y (source, import_hash) únicos parciales', () => {
    expect(migSrc).toMatch(/unique index if not exists uq_customers_source_external\s+on public\.customers\(source, external_id\) where \(external_id is not null\)/)
    expect(migSrc).toMatch(/unique index if not exists uq_customers_source_import_hash\s+on public\.customers\(source, import_hash\) where \(import_hash is not null\)/)
  })
  it('un profile enlaza a lo sumo UN customer (unicidad de profile_id)', () => {
    expect(migSrc).toMatch(/unique index if not exists uq_customers_profile\s+on public\.customers\(profile_id\) where \(profile_id is not null\)/)
  })
  it('customer NO tiene FK a auth.users (existe sin Auth)', () => {
    // profile_id referencia profiles (opcional); no hay references auth.users en customers.
    const block = migSrc.slice(migSrc.indexOf('create table if not exists public.customers'), migSrc.indexOf('enable row level security'))
    expect(block).not.toMatch(/auth\.users/)
    expect(block).toMatch(/profile_id\s+uuid references public\.profiles\(id\)/)
  })
  it('RLS: admin/pos leen, doctor solo el suyo, escritura admin', () => {
    expect(migSrc).toMatch(/customers_select[^]*profile_id = auth\.uid\(\)/)
    expect(migSrc).toMatch(/customers_insert[^]*auth_role\(\) = 'admin'/)
  })
})

describe('garantías DB — orders y doctor_locations soportan customer', () => {
  it('orders.customer_id aditivo, conserva doctor_id', () => {
    expect(migSrc).toMatch(/alter table public\.orders add column if not exists customer_id uuid references public\.customers\(id\)/)
    expect(migSrc).not.toMatch(/drop column .*doctor_id/i)
  })
  it('doctor_locations: customer_id + doctor_id nullable + CHECK de ancla', () => {
    expect(migSrc).toMatch(/alter table public\.doctor_locations add column if not exists customer_id uuid references public\.customers\(id\)/)
    expect(migSrc).toMatch(/alter column doctor_id drop not null/)
    expect(migSrc).toMatch(/ck_doctor_locations_anchor check \(doctor_id is not null or customer_id is not null\)/)
    expect(migSrc).toMatch(/uq_doctor_locations_customer_default/)
  })
  it('RPC de default soporta ancla por customer (y sigue soportando doctor)', () => {
    expect(migSrc).toMatch(/select doctor_id, customer_id, active into v_doctor, v_customer/)
    expect(migSrc).toMatch(/where customer_id = v_customer and active = true/)
    expect(migSrc).toMatch(/where doctor_id = v_doctor and active = true/)
  })
  it('RLS de ubicaciones: dueño vía customer enlazado (profile_id = auth.uid())', () => {
    expect(migSrc).toMatch(/c\.profile_id = auth\.uid\(\)/)
  })
})

describe('store customers — no contamina y no dedup por contacto', () => {
  it('el store SOLO toca la tabla customers', () => {
    const froms = [...storeSrc.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
    expect([...new Set(froms)]).toEqual(['customers'])
  })
  it('createCustomer NO impone unicidad de email/phone (permite duplicados)', () => {
    const fn = storeSrc.slice(storeSrc.indexOf('export async function createCustomer'), storeSrc.indexOf('export async function updateCustomer'))
    expect(fn).not.toMatch(/\.eq\('email'/)
    expect(fn).not.toMatch(/\.eq\('phone'/)
  })
  it('linkCustomerToProfile fija profile_id (conversión idempotente)', () => {
    expect(storeSrc).toMatch(/linkCustomerToProfile/)
    expect(storeSrc).toMatch(/\.update\(\{ profile_id: profileId/)
  })
})

describe('orders — customer_id independiente del portal y del snapshot', () => {
  it('createOrder acepta customer_id y lo guarda sin exigir doctor de portal', () => {
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false, customer_id: 'cust-9' })
    expect(o.customer_id).toBe('cust-9')
  })
  it('createPosOrder acepta customer_id (POS a nombre de cliente comercial)', () => {
    const o = createPosOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100, lot_id: null }], total: 100, payment_method: 'efectivo', customer_id: 'cust-1' }, true)
    expect(o.customer_id).toBe('cust-1')
  })
  it('el snapshot de dirección sigue siendo independiente del customer', () => {
    const addr = { line1: 'Calle 1', city: 'CDMX' }
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false, customer_id: 'cust-2', shipping: addr })
    expect((o.shipping_meta as { address?: unknown }).address).toEqual(addr)
    expect(o.customer_id).toBe('cust-2')
  })
})
