// Catálogo MOCK con la MISMA forma que la vista products_safe (packages/db).
// FUENTE DE VERDAD: el catálogo real de la landing (apps/landing) — nombres,
// categorías, descripciones, precios e imágenes tal como los muestra. Home Care
// con precio; Professional "a consultar" (price null → cotización en el Portal).
// Imágenes reales en apps/web/public/products/. NO se inventa nada que la landing
// no respalde. Al conectar Supabase, esto se reemplaza por un select a products_safe.
import type { ProductSafe } from '../types'

export const MOCK_PRODUCTS: ProductSafe[] = [
  // ── Home Care (cosm) · precio público MXN ──────────────────────────────
  { id: 'p-mgp-90', sku: 'MGP-90', name: 'Mascarilla GP', line: 'cosm', category: 'Mascarilla facial', description: 'Hidrogel con péptidos. Tratamiento intensivo en una aplicación.', price: 890, unit: 'unit', image_url: '/products/mascarilla-golden-placenta.webp' },
  { id: 'p-gs-114', sku: 'GS-114', name: 'Golden Serum', line: 'cosm', category: 'Suero facial', description: 'Suero antiedad con extractos placentarios. Aplicación nocturna.', price: 1890, unit: 'unit', image_url: '/products/golden-serum.webp' },
  { id: 'p-ab-50', sku: 'AB-50', name: 'Antiaging Booster', line: 'cosm', category: 'Booster facial', description: 'Concentrado intensivo. Potencia cualquier rutina antiedad.', price: 1450, unit: 'unit', image_url: '/products/antiaging-booster.webp' },
  { id: 'p-sh-19', sku: 'SH-19', name: 'Stemhair', line: 'cosm', category: 'Tratamiento capilar', description: 'Tratamiento capilar. Densidad y crecimiento desde la raíz.', price: 1290, unit: 'unit', image_url: '/products/stemhair.webp' },
  { id: 'p-pl-12', sku: 'PL-12', name: 'Plumper', line: 'cosm', category: 'Voluminizador labial', description: 'Voluminizador labial con péptidos. Efecto inmediato.', price: 680, unit: 'unit', image_url: '/products/plumper.webp' },

  // ── Professional (prof) · precio null = "a consultar" / cotización ──────
  { id: 'p-int-01', sku: 'INT-01', name: 'Íntimo Renovacell', line: 'prof', category: 'Inyectable · Bioestimulante', description: 'Bioestimulante para revitalización de tejidos íntimos femeninos.', price: null, unit: 'unit', image_url: '/products/intimo-renovacell.webp' },
  { id: 'p-gp-300', sku: 'GP-300', name: 'Golden Placenta', line: 'prof', category: 'Inyectable · Regenerativo', description: 'Extractos frescos bioactivos de placenta humana en máxima concentración.', price: null, unit: 'unit', image_url: '/products/golden-placenta.webp' },
  { id: 'p-ufs-11', sku: 'UFS-11', name: 'Ultrafiltrados UFS', line: 'prof', category: 'Inyectable · Péptidos', description: 'Péptidos nativos por ultrafiltración. 11 variantes según órgano diana.', price: null, unit: 'unit', image_url: '/products/ultrafiltrados-ufs.webp' },
  { id: 'p-gv-07', sku: 'GV-07', name: 'Golden V', line: 'prof', category: 'Inyectable · Vegetal', description: 'Origen vegetal con glutatión. Bajo riesgo inmunológico.', price: null, unit: 'unit', image_url: '/products/golden-v.webp' },
  { id: 'p-sac-21', sku: 'SAC-21', name: 'Suero Antiedad Cellular', line: 'prof', category: 'Inyectable · Celular', description: 'Suero inyectable con péptidos celulares activos. Regeneración tisular dermal profunda.', price: null, unit: 'unit', image_url: '/products/suero-antiedad-cellular.webp' },
  { id: 'p-stl-44', sku: 'STL-44', name: 'Stoplip', line: 'prof', category: 'Inyectable · Mesoterapia', description: 'Mesoterapia inyectable para grasa localizada y lipodistrofia.', price: null, unit: 'unit', image_url: '/products/stoplip.webp' },
]
