// Siembra el INVENTARIO INICIAL (lots) + su entrada en el ledger
// (inventory_movements). Idempotente por lot_code. Los productos deben existir
// (correr seed_catalog.mjs antes). Uso:
//   set -a; source supabase/.env.local; set +a; node scripts/seed_inventory.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const s = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// SKU por lote (para resolver product_id real) + datos del lote.
const LOTS = [
  { sku: 'MGP-90', lot_code: 'MGP-90-A', manufacture_date: '2026-02-01', expiry_date: '2026-08-15', quantity: 30, location: 'Culiacán' },
  { sku: 'MGP-90', lot_code: 'MGP-90-B', manufacture_date: '2026-05-01', expiry_date: '2026-12-01', quantity: 50, location: 'Culiacán' },
  { sku: 'GS-114', lot_code: 'GS-114-1', manufacture_date: '2026-03-01', expiry_date: '2026-09-10', quantity: 20, location: 'Culiacán' },
  { sku: 'AB-50',  lot_code: 'AB-50-1',  manufacture_date: '2026-01-01', expiry_date: '2026-07-05', quantity: 12, location: 'Culiacán' },
  { sku: 'AB-50',  lot_code: 'AB-50-2',  manufacture_date: '2026-06-01', expiry_date: '2027-01-20', quantity: 40, location: 'Culiacán' },
  { sku: 'SH-19',  lot_code: 'SH-19-1',  manufacture_date: '2026-04-01', expiry_date: '2026-10-01', quantity: 25, location: 'Culiacán' },
  { sku: 'PL-12',  lot_code: 'PL-12-1',  manufacture_date: '2026-03-01', expiry_date: '2026-08-30', quantity: 18, location: 'Culiacán' },
  { sku: 'PL-12',  lot_code: 'PL-12-2',  manufacture_date: '2026-07-01', expiry_date: '2027-02-01', quantity: 40, location: 'Culiacán' },
  { sku: 'GP-300', lot_code: 'GP-300',   manufacture_date: null,         expiry_date: '2027-03-01', quantity: 14, location: 'Praga' },
  { sku: 'UFS-11', lot_code: 'UFS-11',   manufacture_date: null,         expiry_date: '2026-11-01', quantity: 22, location: 'Culiacán' },
  { sku: 'GV-07',  lot_code: 'GV-07',    manufacture_date: null,         expiry_date: '2027-01-01', quantity: 5,  location: 'Culiacán' },
  { sku: 'SAC-21', lot_code: 'SAC-21',   manufacture_date: null,         expiry_date: '2026-10-01', quantity: 18, location: 'Culiacán' },
  { sku: 'STL-44', lot_code: 'STL-44',   manufacture_date: null,         expiry_date: '2026-04-01', quantity: 9,  location: 'Culiacán' }, // caducado (demo alerta)
  { sku: 'INT-01', lot_code: 'INT-01',   manufacture_date: null,         expiry_date: '2027-03-01', quantity: 24, location: 'Culiacán' },
]

// sku -> product uuid
const prods = await s.from('products').select('id, sku')
if (prods.error) { console.error('products:', prods.error.message); process.exit(1) }
const skuToId = Object.fromEntries(prods.data.map((p) => [p.sku, p.id]))

// lot_code -> lot uuid (existentes, para idempotencia)
const existing = await s.from('lots').select('id, lot_code')
const codeToId = Object.fromEntries((existing.data ?? []).map((l) => [l.lot_code, l.id]))

for (const l of LOTS) {
  const product_id = skuToId[l.sku]
  if (!product_id) { console.error(`sin producto para SKU ${l.sku}`); continue }
  let lotId = codeToId[l.lot_code]
  if (lotId) {
    await s.from('lots').update({ product_id, manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: l.quantity, location: l.location }).eq('id', lotId)
    console.log(`= lote ${l.lot_code} (actualizado, ${l.quantity}u)`)
  } else {
    const ins = await s.from('lots').insert({ product_id, lot_code: l.lot_code, manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: l.quantity, location: l.location }).select('id').single()
    if (ins.error) { console.error(`lote ${l.lot_code}:`, ins.error.message); continue }
    lotId = ins.data.id
    // Entrada al ledger (inmutable) que dio origen al lote.
    const mv = await s.from('inventory_movements').insert({ lot_id: lotId, change: l.quantity, reason: 'entrada', reference: l.lot_code, created_at: (l.manufacture_date ?? '2026-01-01') + 'T10:00:00Z' })
    console.log(`+ lote ${l.lot_code} (${l.quantity}u)  entrada:${mv.error ? ' ERROR ' + mv.error.message : ' ok'}`)
  }
}
console.log('Inventario inicial sembrado.')
