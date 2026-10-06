// UX-2 · Guardas: terminología única (Compras a proveedores / Recibir mercancía), la compra NO es
// inventario, la orden nace solo por comando idempotente, "Marcar pagado" solo para quien puede,
// entradas excepcionales solo Dirección, y ninguna autoridad de inventario en el navegador.
import { describe, it, expect } from 'vitest'
import rolesSrc from '../../app/roles.ts?raw'
import comprasSrc from '../../screens/admin/Reabastecimiento.tsx?raw'
import entradasSrc from '../../screens/warehouse/Entradas.tsx?raw'
import modalSrc from '../../screens/warehouse/RecibirMercanciaModal.tsx?raw'
import storeSrc from '../store/comprasStore.ts?raw'
import w1Src from './w1Command.ts?raw'
import mig from '../../../../../supabase/migrations/20261105120000_ux_compras_idempotentes_chat_leido.sql?raw'
import down from '../../../../../supabase/rollback/ux_compras_chat/99_down.sql?raw'
import { getRole, getNav } from '../../app/roles'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const fuentes = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/*.test.ts', '!../../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('UX-2 · terminología', () => {
  it('13 · Almacén y Dirección usan los MISMOS nombres; "Registrar entradas" y "Compras" a secas desaparecieron', () => {
    const wh = getNav(getRole('warehouse')); const adm = getNav(getRole('admin'))
    expect(wh.find((s) => s.key === 'entradas')?.label).toBe('Recibir mercancía')
    expect(wh.find((s) => s.key === 'compras')?.label).toBe('Compras a proveedores')
    expect(adm.find((s) => s.key === 'av_inv')?.label).toBe('Compras a proveedores')
    expect(codigo(rolesSrc)).not.toMatch(/label: 'Compras'|Registrar entradas|label: 'Inventario'/)
    for (const [p, src] of Object.entries(fuentes)) if (!/guard/.test(p)) expect(src, p).not.toMatch(/Registrar entradas/)
    expect(comprasSrc).toMatch(/<PageHead title="Compras a proveedores">/)
    expect(entradasSrc).toMatch(/<PageHead title="Recibir mercancía">/)
    expect(entradasSrc).toMatch(/Entradas excepcionales \(solo Dirección\)/)
  })
})

describe('UX-2 · la compra no es inventario; recibir sí', () => {
  it('14/21 · la pantalla de compras no toca lotes ni kardex; el modal recibe con recibir_lote (orden) vía store', () => {
    for (const s of [comprasSrc, entradasSrc, modalSrc, storeSrc]) expect(codigo(s)).not.toMatch(/from\(\s*['"](lots|inventory_movements|purchase_receipts)['"]\s*\)|\.rpc\(/)
    expect(codigo(modalSrc)).toMatch(/kind: mode === 'excedente' \? 'excedente' : 'orden'/)
    expect(codigo(modalSrc)).toMatch(/replenishment_id: po\.id/)
    expect(codigo(comprasSrc)).toMatch(/El inventario NO cambia hasta que Almacén reciba la mercancía/)
  })
  it('15/16 · ambas pantallas comparten el MISMO modal de recepción (parcial, acumulada, con op_id)', () => {
    expect(codigo(comprasSrc)).toMatch(/<RecibirMercanciaModal/); expect(codigo(entradasSrc)).toMatch(/<RecibirMercanciaModal/)
    expect(codigo(modalSrc)).toMatch(/const \{ opId \} = useOpId\(\)/)
    expect(codigo(modalSrc)).toMatch(/n <= pend/)
  })
})

describe('UX-2 · P2-1 alta idempotente', () => {
  const m = codigo(mig)
  it('17 · el store ya no inserta en replenishments; usa el comando con op_id de la intención', () => {
    const s = codigo(storeSrc)
    expect(s).not.toMatch(/from\('replenishments'\)\s*\.insert/)
    expect(s).toMatch(/runW1Command<[^>]*>\('crear_orden_compra', \{\n\s+p_op_id: opId/)
    expect(codigo(comprasSrc)).toMatch(/const \{ opId, renew \} = useOpId\(\)/)
    expect(codigo(comprasSrc)).toMatch(/if \(ok\) renew\(\)/)
    expect(codigo(w1Src)).toMatch(/'crear_orden_compra'/)
  })
  it('migración 122: security definer, Dirección/Facturación, registro W1, sin inventario, sin anon', () => {
    const fn = m.slice(m.indexOf('create or replace function public.crear_orden_compra'), m.indexOf('revoke all on function public.crear_orden_compra'))
    expect(fn).toMatch(/security definer/)
    expect(fn).toMatch(/if v_role not in \('admin', 'billing'\) then raise exception 'NO_AUTORIZADO/)
    expect(fn).toMatch(/_w1_op_begin\(p_op_id, 'alta_compra', v_req\)/)
    expect(fn).toMatch(/_w1_op_finish\(p_op_id, 'alta_compra', v_req, v_res\)/)
    expect(fn).not.toMatch(/lots|inventory_movements|purchase_receipts/)
    expect(m).toMatch(/revoke all on function public\.crear_orden_compra\(uuid, uuid, integer, numeric, text, text, text\) from public, anon/)
    expect(codigo(down)).toMatch(/drop function if exists public\.crear_orden_compra/)
  })
})

describe('UX-2 · P2-2 marcar pagado', () => {
  it('18/19 · la pantalla oculta la acción a quien no puede; el store no da éxito con 0 filas', () => {
    const c = codigo(comprasSrc); const s = codigo(storeSrc)
    expect(c).toMatch(/const puedeComprar = PUEDE_MARCAR_PAGADO\(role\)/)
    expect(c).toMatch(/!o\.paid && puedeComprar && \(/)
    expect(c).toMatch(/: puedeComprar\n\s+\? <button/)
    expect(s).toMatch(/export const PUEDE_MARCAR_PAGADO = \(role: string \| null \| undefined\): boolean => role === 'admin' \|\| role === 'billing'/)
    expect(s).toMatch(/\.update\(\{ paid: true \}\)\.eq\('id', id\)\.select\('id'\)/)
    expect(s).toMatch(/if \(!res\.data \|\| res\.data\.length === 0\) \{ void live\.reload\(\); return \{ ok: false/)
  })
  it('20 · entradas excepcionales solo Dirección (y el servidor lo exige igual)', () => {
    const e = codigo(entradasSrc)
    expect(e).toMatch(/\{isAdmin\n\s+\? <EntradasExcepcionales/)
    expect(e).toMatch(/kind: 'sin_orden'/)
    expect(e).not.toMatch(/MOTIVOS_EXCEPCIONALES = \[[^\]]*Carga inicial/)   // la carga inicial va por Importar / Migración
  })
})
