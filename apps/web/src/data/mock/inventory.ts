// Lotes y movimientos MOCK, con la forma de las tablas `lots` e
// `inventory_movements` de packages/db/schema.sql. product_id referencia el
// catálogo mock. Varios productos tienen MÁS DE UN lote para demostrar FEFO.
import type { Lot, InventoryMovement } from '../types'

export const MOCK_LOTS: Lot[] = [
  // Mascarilla GP — 2 lotes (FEFO debe elegir el A, caduca antes)
  { id: 'l-mgp-a', product_id: 'p-mgp-90', lot_code: 'MGP-90-A', manufacture_date: '2026-02-01', expiry_date: '2026-08-15', quantity: 30, location: 'Culiacán', metadata: null },
  { id: 'l-mgp-b', product_id: 'p-mgp-90', lot_code: 'MGP-90-B', manufacture_date: '2026-05-01', expiry_date: '2026-12-01', quantity: 50, location: 'Culiacán', metadata: null },
  // Golden Serum
  { id: 'l-gs-1', product_id: 'p-gs-114', lot_code: 'GS-114-1', manufacture_date: '2026-03-01', expiry_date: '2026-09-10', quantity: 20, location: 'Culiacán', metadata: null },
  // Antiaging Booster — 2 lotes
  { id: 'l-ab-1', product_id: 'p-ab-50', lot_code: 'AB-50-1', manufacture_date: '2026-01-01', expiry_date: '2026-07-05', quantity: 12, location: 'Culiacán', metadata: null },
  { id: 'l-ab-2', product_id: 'p-ab-50', lot_code: 'AB-50-2', manufacture_date: '2026-06-01', expiry_date: '2027-01-20', quantity: 40, location: 'Culiacán', metadata: null },
  // Stemhair
  { id: 'l-sh-1', product_id: 'p-sh-19', lot_code: 'SH-19-1', manufacture_date: '2026-04-01', expiry_date: '2026-10-01', quantity: 25, location: 'Culiacán', metadata: null },
  // Plumper — 2 lotes
  { id: 'l-pl-1', product_id: 'p-pl-12', lot_code: 'PL-12-1', manufacture_date: '2026-03-01', expiry_date: '2026-08-30', quantity: 18, location: 'Culiacán', metadata: null },
  { id: 'l-pl-2', product_id: 'p-pl-12', lot_code: 'PL-12-2', manufacture_date: '2026-07-01', expiry_date: '2027-02-01', quantity: 40, location: 'Culiacán', metadata: null },
  // Profesionales (lote único, datos del seed)
  { id: 'l-gp-300', product_id: 'p-gp-300', lot_code: 'GP-300', manufacture_date: null, expiry_date: '2027-03-01', quantity: 14, location: 'Praga', metadata: null },
  { id: 'l-ufs-11', product_id: 'p-ufs-11', lot_code: 'UFS-11', manufacture_date: null, expiry_date: '2026-11-01', quantity: 22, location: 'Culiacán', metadata: null },
  { id: 'l-gv-07', product_id: 'p-gv-07', lot_code: 'GV-07', manufacture_date: null, expiry_date: '2027-01-01', quantity: 5, location: 'Culiacán', metadata: null },
  { id: 'l-sac-21', product_id: 'p-sac-21', lot_code: 'SAC-21', manufacture_date: null, expiry_date: '2026-10-01', quantity: 18, location: 'Culiacán', metadata: null },
  // Stoplip — CADUCADO (expiry < hoy) para demostrar la alerta de caducidades
  { id: 'l-stl-44', product_id: 'p-stl-44', lot_code: 'STL-44', manufacture_date: null, expiry_date: '2026-04-01', quantity: 9, location: 'Culiacán', metadata: null },
  // Íntimo Renovacell — con stock para que el catálogo muestre disponibilidad real.
  { id: 'l-int-01', product_id: 'p-int-01', lot_code: 'INT-01', manufacture_date: null, expiry_date: '2027-03-01', quantity: 24, location: 'Culiacán', metadata: null },
]

// Ledger inicial (entradas que dieron origen a los lotes). INMUTABLE: solo se agrega.
export const MOCK_MOVEMENTS: InventoryMovement[] = [
  { id: 'm-1', lot_id: 'l-mgp-a', change: 30, reason: 'entrada', reference: 'MGP-90-A', created_by: null, created_at: '2026-02-05T10:00:00Z' },
  { id: 'm-2', lot_id: 'l-mgp-b', change: 50, reason: 'entrada', reference: 'MGP-90-B', created_by: null, created_at: '2026-05-03T10:00:00Z' },
  { id: 'm-3', lot_id: 'l-ab-1', change: 12, reason: 'entrada', reference: 'AB-50-1', created_by: null, created_at: '2026-01-10T10:00:00Z' },
  { id: 'm-4', lot_id: 'l-stl-44', change: 9, reason: 'entrada', reference: 'STL-44', created_by: null, created_at: '2025-10-01T10:00:00Z' },
]
