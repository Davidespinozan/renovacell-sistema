// `supabase.rpc` ES UN MÉTODO (27 nov 2026 · error en vivo: «genera el pedido con Solicitar factura y se queda guardando»).
// Cuatro llamadas lo guardaban suelto en una variable (`const rpc = supabase.rpc as …`) y lo llamaban después: en el
// navegador real eso truena con «Cannot read properties of undefined (reading 'rest')» porque el método pierde su dueño.
// Estuvieron así desde el 25 sep; las pruebas no lo veían porque simulaban `rpc` con una función suelta. Aquí el cliente
// simulado es una CLASE cuyo `rpc` depende de `this`, igual que el de verdad.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const h = vi.hoisted(() => {
  const llamadas: Array<[string, unknown]> = []
  class ClienteComoElReal {
    rest = { rpc: async (fn: string, args: unknown) => { llamadas.push([fn, args]); return { data: fn === 'resolve_customer_identity' ? { status: 'NOT_FOUND', customer_id: null, signals: [] } : null, error: null } } }
    rpc(fn: string, args: unknown) { return this.rest.rpc(fn, args) }   // como supabase-js: `return this.rest.rpc(...)`
    from() { const c: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'update', 'order', 'limit', 'in']) c[k] = () => c; c.maybeSingle = async () => ({ data: null, error: null }); c.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null }); return c }
  }
  return { llamadas, cliente: new ClienteComoElReal() }
})
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: h.cliente, currentUserId: () => 'U-1' }))
import { upsertCustomerFiscal, upsertCustomerContact, resolveCustomerIdentity } from './customersStore'
import { setOrderFiscalSnapshot } from './ordersStore'

const FISCAL = { rfc: 'GAPE8001015K2', razon_social: 'PATRICIA ELENA GASTELUM', regimen: '612', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'p@correo.mx' }
beforeEach(() => { h.llamadas.length = 0 })

describe('las llamadas al servidor conservan a su dueño', () => {
  it('guardar los datos fiscales del cliente ya no truena (antes dejaba el pedido «Guardando…»)', async () => {
    await expect(upsertCustomerFiscal('11111111-1111-4111-8111-111111111111', FISCAL)).resolves.toEqual({ ok: true })
    expect(h.llamadas[0][0]).toBe('upsert_customer_fiscal')
  })
  it('guardar los datos fiscales del PEDIDO en Facturación ya no truena', async () => {
    await expect(setOrderFiscalSnapshot('22222222-2222-4222-8222-222222222222', FISCAL)).resolves.toEqual({ ok: true })
    expect(h.llamadas.map((l) => l[0])).toContain('set_order_fiscal_snapshot')
  })
  it('guardar el contacto del cliente y reconocer a un cliente tampoco', async () => {
    await expect(upsertCustomerContact('11111111-1111-4111-8111-111111111111', { phone: '6671234567' })).resolves.toEqual({ ok: true })
    await expect(resolveCustomerIdentity({ phone: '6671234567' })).resolves.toMatchObject({ status: 'NOT_FOUND' })
    expect(h.llamadas.map((l) => l[0])).toEqual(['upsert_customer_contact', 'resolve_customer_identity'])
  })
  it('si la llamada truena por lo que sea, responde con un error en palabras: la pantalla nunca se queda colgada', async () => {
    const original = h.cliente.rest.rpc
    h.cliente.rest.rpc = async () => { throw new Error('sin red') }
    try {
      await expect(upsertCustomerFiscal('11111111-1111-4111-8111-111111111111', FISCAL)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/No se pudieron guardar los datos fiscales/) })
      await expect(setOrderFiscalSnapshot('22222222-2222-4222-8222-222222222222', FISCAL)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/datos fiscales del pedido/) })
      await expect(upsertCustomerContact('11111111-1111-4111-8111-111111111111', { phone: '6671234567' })).resolves.toMatchObject({ ok: false })
      await expect(resolveCustomerIdentity({ phone: '6671234567' })).resolves.toBeNull()
    } finally { h.cliente.rest.rpc = original }
  })
})

describe('candado: nadie vuelve a guardar `supabase.rpc` suelto', () => {
  const raiz = resolve(__dirname, '../..')
  const archivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [] })
  it('toda asignación de `supabase.rpc` a una variable lleva `.bind(supabase)`', () => {
    const malos: string[] = []
    for (const f of archivos(raiz)) {
      const codigo = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // Renglón que ASIGNA `supabase.rpc` (o su conversión de tipo) a algo. Está bien si va ligado (`.bind(supabase)`),
      // si es una llamada directa (`supabase.rpc(…)`) o si la conversión se llama en el mismo renglón (`(… as T)(…)`:
      // ahí JavaScript conserva al dueño). Lo que truena es guardarlo y llamarlo después.
      for (const renglon of codigo.split('\n')) {
        const m = /=\s*\(?\s*supabase\.rpc\b(.*)$/.exec(renglon)
        if (!m) continue
        const resto = m[1]
        if (resto.startsWith('.bind(supabase)') || resto.startsWith('(') || resto.includes(')(')) continue
        malos.push(`${f.replace(raiz, 'src')}: ${renglon.trim().slice(0, 90)}`)
      }
    }
    expect(malos).toEqual([])
  })
})
