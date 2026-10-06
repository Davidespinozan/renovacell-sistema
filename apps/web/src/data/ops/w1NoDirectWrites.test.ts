// W1 · GUARDA DE CÓDIGO: ninguna ruta del cliente escribe directo en las tablas de
// inventario ni mueve pedidos a packed/cancelled; todo pasa por comandos del servidor.
import { describe, it, expect } from 'vitest'

const files = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/*.test.ts', '!../../**/*.test.tsx', '!../../data/database.types.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "rpc('apply_lot_movement')", re: /rpc\(\s*['"]apply_lot_movement['"]/ },
  { name: 'escritura directa a lots', re: /from\(\s*['"]lots['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'inserción directa al kardex', re: /from\(\s*['"]inventory_movements['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'escritura directa a order_items', re: /from\(\s*['"]order_items['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'estado/acumulado de compra directo', re: /from\(\s*['"]replenishments['"]\s*\)\s*\.\s*update\(\s*\{\s*(status|received_qty)/ },
  // UX-2 / P2-1 · la orden de compra nace SOLO por crear_orden_compra (idempotente); nunca por insert directo.
  { name: 'alta de compra directa', re: /from\(\s*['"]replenishments['"]\s*\)\s*\.\s*insert\b/ },
  { name: "orders → 'cancelled'/'packed' directo", re: /from\(\s*['"]orders['"]\s*\)\s*\.\s*update\(\s*\{\s*status:\s*['"](cancelled|packed)['"]/ },
  { name: 'RPC W1 sin el cliente de comandos', re: /\.rpc\(\s*['"](recibir_lote|surtir_pedido|importar_lote|crear_orden_compra|cerrar_orden_compra|cancelar_pedido|ajustar_lote|confirmar_reingreso|recibir_devolucion|disponer_devolucion|anular_guia_manual)['"]/ },
  // W3-C · la configuración fiscal del catálogo solo cambia por comando de C1.
  { name: 'escritura directa a product_fiscal', re: /from\(\s*['"]product_fiscal['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'escritura directa a fiscal_category_defaults', re: /from\(\s*['"]fiscal_category_defaults['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'escritura directa a la evidencia fiscal', re: /from\(\s*['"]fiscal_price_evidence['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'escritura directa a la bitácora fiscal del producto', re: /from\(\s*['"]product_fiscal_events['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  { name: 'escritura directa a los candidatos por familia', re: /from\(\s*['"]fiscal_family_defaults['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
  // W4 · el buzón de mensajes al cliente solo cambia por sus comandos (nadie marca "enviado" a mano).
  { name: 'escritura directa al buzón de mensajes', re: /['"]comm_outbox['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/ },
]

const CONTROLS = [
  "supabase.rpc('apply_lot_movement', { p_lot: x })",
  "supabase.from('lots').update({ quantity: 1 })",
  "supabase.from('inventory_movements').insert({})",
  "supabase.from('order_items').update({ lot_id: x })",
  "supabase.from('replenishments').update({ status: 'recibida' })",
  "supabase.from('replenishments').insert({ qty: 1 })",
  "supabase.from('orders').update({ status: 'cancelled' })",
  "supabase.rpc('surtir_pedido', {})",
  "supabase.from('product_fiscal').update({ validado: true })",
  "supabase.from('fiscal_category_defaults').upsert({})",
  "supabase.from('fiscal_price_evidence').insert({})",
  "supabase.from('product_fiscal_events').delete()",
  "supabase.from('fiscal_family_defaults').update({})",
  "supabase.from('comm_outbox').update({ status: 'enviado' })",
]

describe('W1: sin escrituras directas de inventario en el cliente', () => {
  it('control positivo: cada patrón SÍ detecta una escritura prohibida', () => {
    CONTROLS.forEach((c, i) => expect(FORBIDDEN[i].re.test(c)).toBe(true))
  })
  it('escanea el código de la app', () => { expect(Object.keys(files).length).toBeGreaterThan(150) })
  for (const f of FORBIDDEN) {
    it(`sin ${f.name}`, () => {
      const hits = Object.entries(files).filter(([, src]) => f.re.test(src)).map(([p]) => p)
      expect(hits).toEqual([])
    })
  }
})
