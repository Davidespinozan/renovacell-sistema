// Catálogo MOCK con la MISMA forma que la vista products_safe (packages/db).
// Datos tomados de packages/db/seeds/seed_products.sql.
// Al conectar Supabase, esto se reemplaza por un select a `products_safe`.
import type { ProductSafe } from '../types'

export const MOCK_PRODUCTS: ProductSafe[] = [
  // Home Care (cosm) — precio público MXN
  { id: 'p-mgp-90', sku: 'MGP-90', name: 'Mascarilla GP', line: 'cosm', category: 'Bestseller', description: 'Hidrogel con péptidos. Tratamiento intensivo en una aplicación.', price: 890, unit: 'unit' },
  { id: 'p-gs-114', sku: 'GS-114', name: 'Golden Serum', line: 'cosm', category: 'Premium', description: 'Suero antiedad con extractos placentarios. Aplicación nocturna.', price: 1890, unit: 'unit' },
  { id: 'p-ab-50', sku: 'AB-50', name: 'Antiaging Booster', line: 'cosm', category: 'Antiedad', description: 'Concentrado intensivo. Potencia cualquier rutina antiedad.', price: 1450, unit: 'unit' },
  { id: 'p-sh-19', sku: 'SH-19', name: 'Stemhair', line: 'cosm', category: 'Capilar', description: 'Tratamiento capilar. Densidad y crecimiento desde la raíz.', price: 1290, unit: 'unit' },
  { id: 'p-pl-12', sku: 'PL-12', name: 'Plumper', line: 'cosm', category: 'Nuevo', description: 'Voluminizador labial con péptidos. Efecto inmediato.', price: 680, unit: 'unit' },
  // Profesional (prof) — precio null = "a consultar"
  { id: 'p-gp-300', sku: 'GP-300', name: 'Golden Placenta', line: 'prof', category: 'Bandera · 300 kDa', description: 'Extractos frescos bioactivos de placenta humana en máxima concentración.', price: null, unit: 'unit' },
  { id: 'p-ufs-11', sku: 'UFS-11', name: 'Ultrafiltrados UFS', line: 'prof', category: '11 variantes · 10 kDa', description: 'Péptidos nativos por ultrafiltración. 11 variantes según órgano diana.', price: null, unit: 'unit' },
  { id: 'p-gv-07', sku: 'GV-07', name: 'Golden V', line: 'prof', category: 'Vegetal · + GSH', description: 'Origen vegetal con glutatión. Bajo riesgo inmunológico.', price: null, unit: 'unit' },
  { id: 'p-sac-21', sku: 'SAC-21', name: 'Suero Antiedad Cellular', line: 'prof', category: 'Inyectable · Antiedad', description: 'Suero inyectable con péptidos celulares activos. Regeneración tisular dermal profunda.', price: null, unit: 'unit' },
  { id: 'p-stl-44', sku: 'STL-44', name: 'Stoplip', line: 'prof', category: 'Inyectable · Lipolítico', description: 'Mesoterapia inyectable para grasa localizada y lipodistrofia.', price: null, unit: 'unit' },
]
