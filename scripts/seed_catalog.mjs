// Siembra el catálogo real (products) y sus costos (product_costs) — idempotente
// por SKU. Uso: `set -a; source supabase/.env.local; set +a; node scripts/seed_catalog.mjs`
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const s = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Catálogo con la forma de products_safe + costo (unit_cost) para product_costs.
const CATALOG = [
  // Home Care (cosm)
  { sku: 'MGP-90', name: 'Mascarilla GP', line: 'cosm', category: 'Mascarilla facial', description: 'Hidrogel con péptidos. Tratamiento intensivo en una aplicación.', price: 890, image_url: '/products/mascarilla-golden-placenta.webp', unit_cost: 400 },
  { sku: 'GS-114', name: 'Golden Serum', line: 'cosm', category: 'Suero facial', description: 'Suero antiedad con extractos placentarios. Aplicación nocturna.', price: 1890, image_url: '/products/golden-serum.webp', unit_cost: 850 },
  { sku: 'AB-50', name: 'Antiaging Booster', line: 'cosm', category: 'Booster facial', description: 'Concentrado intensivo. Potencia cualquier rutina antiedad.', price: 1450, image_url: '/products/antiaging-booster.webp', unit_cost: 650 },
  { sku: 'SH-19', name: 'Stemhair', line: 'cosm', category: 'Tratamiento capilar', description: 'Tratamiento capilar. Densidad y crecimiento desde la raíz.', price: 1290, image_url: '/products/stemhair.webp', unit_cost: 580 },
  { sku: 'PL-12', name: 'Plumper', line: 'cosm', category: 'Voluminizador labial', description: 'Voluminizador labial con péptidos. Efecto inmediato.', price: 680, image_url: '/products/plumper.webp', unit_cost: 300 },
  // Professional (prof) — precios/costos placeholder
  { sku: 'INT-01', name: 'Íntimo Renovacell', line: 'prof', category: 'Inyectable · Bioestimulante', description: 'Bioestimulante para revitalización de tejidos íntimos femeninos.', price: 5900, image_url: '/products/intimo-renovacell.webp', unit_cost: 2600 },
  { sku: 'GP-300', name: 'Golden Placenta', line: 'prof', category: 'Inyectable · Regenerativo', description: 'Extractos frescos bioactivos de placenta humana en máxima concentración.', price: 6900, image_url: '/products/golden-placenta.webp', unit_cost: 3000 },
  { sku: 'UFS-11', name: 'Ultrafiltrados UFS', line: 'prof', category: 'Inyectable · Péptidos', description: 'Péptidos nativos por ultrafiltración. 11 variantes según órgano diana.', price: 5400, image_url: '/products/ultrafiltrados-ufs.webp', unit_cost: 2400 },
  { sku: 'GV-07', name: 'Golden V', line: 'prof', category: 'Inyectable · Vegetal', description: 'Origen vegetal con glutatión. Bajo riesgo inmunológico.', price: 4200, image_url: '/products/golden-v.webp', unit_cost: 1850 },
  { sku: 'SAC-21', name: 'Suero Antiedad Cellular', line: 'prof', category: 'Inyectable · Celular', description: 'Suero inyectable con péptidos celulares activos. Regeneración tisular dermal profunda.', price: 4800, image_url: '/products/suero-antiedad-cellular.webp', unit_cost: 2100 },
  { sku: 'STL-44', name: 'Stoplip', line: 'prof', category: 'Inyectable · Mesoterapia', description: 'Mesoterapia inyectable para grasa localizada y lipodistrofia.', price: 3900, image_url: '/products/stoplip.webp', unit_cost: 1700 },
]

for (const c of CATALOG) {
  const { data, error } = await s.from('products').upsert({
    sku: c.sku, name: c.name, line: c.line, category: c.category,
    description: c.description, price: c.price, unit: 'unit', image_url: c.image_url,
  }, { onConflict: 'sku' }).select('id, sku').single()
  if (error) { console.error(`product ${c.sku}:`, error.message); continue }
  const { error: cerr } = await s.from('product_costs').upsert({
    product_id: data.id, unit_cost: c.unit_cost,
  }, { onConflict: 'product_id' })
  console.log(`${c.sku} → ${data.id.slice(0, 8)}…  precio $${c.price}  costo $${c.unit_cost}  ${cerr ? 'COSTO ERROR ' + cerr.message : 'ok'}`)
}
console.log('Catálogo sembrado.')
