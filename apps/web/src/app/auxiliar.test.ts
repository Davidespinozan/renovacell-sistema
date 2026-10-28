// AUXILIAR DE ALMACÉN (rol packing · Blanca): inventario físico, surtir, empacar y despachar. Lo digital (recibir
// mercancía, compras, devoluciones, custodia, guías y seguimiento) es de Almacén (Alberto).
import { describe, it, expect } from 'vitest'
import { getNav, getRole } from './roles'
import { ROLE_MAP } from '../auth/supabaseAuth'
import colaSrc from '../screens/packing/Cola.tsx?raw'
import bandejaSrc from '../screens/Bandeja.tsx?raw'
import shippingSrc from '../../../../supabase/functions/shipping/index.ts?raw'
import migSrc from '../../../../supabase/migrations/20270201120000_auxiliar_almacen.sql?raw'

const keys = (r: 'packing' | 'warehouse') => getNav(getRole(r)).map((s) => s.key)

describe('AUXILIAR de almacén', () => {
  it('el rol packing de la base es "Auxiliar de almacén" (ya no se confunde con Almacén)', () => {
    expect(ROLE_MAP.packing).toBe('packing')
    expect(getRole('packing').label).toBe('Auxiliar de almacén')
  })
  it('su menú: inventario físico, surtir, empacar, despachar y horarios', () => {
    expect(keys('packing')).toEqual(expect.arrayContaining(['stock', 'caduc', 'surtido', 'cola', 'despacho', 'agenda_entregas']))
    for (const k of ['compras', 'entradas', 'devoluciones', 'consigna_alm', 'guia', 'seguimiento']) expect(keys('packing')).not.toContain(k)
  })
  it('Almacén (Alberto) conserva todo', () => {
    expect(keys('warehouse')).toEqual(expect.arrayContaining(['compras', 'entradas', 'devoluciones', 'consigna_alm', 'guia', 'seguimiento', 'stock', 'surtido', 'cola', 'despacho']))
  })
  it('en "Por enviar" el auxiliar no genera guía; el servidor tampoco lo deja', () => {
    expect(colaSrc).toMatch(/const puedeGuia = useRoleOpcional\(\)\?\.role !== 'packing'/)
    expect(colaSrc).toMatch(/method === 'paqueteria' && !puedeGuia/)
    expect(shippingSrc).toMatch(/\['create_shipment', 'label', 'schedule_pickup', 'cancel_pickup', 'reconciliar_guia'\]\.includes\(action\) && !tieneRol\(q\.quien, \['admin', 'warehouse'\]\)/)
    for (const f of ['recibir_lote', 'recibir_devolucion', 'confirmar_reingreso', 'anular_guia', 'abrir_custodia', 'entregar_custodia', 'devolver_de_custodia', 'registrar_perdida_custodia']) expect(migSrc).toContain(`FUNCTION public.${f}(`)
    expect(migSrc.split('CREATE OR REPLACE FUNCTION').slice(1).every((f) => !f.includes("'packing'"))).toBe(true)
  })
  it('sus pendientes de Inicio no incluyen recibir compras ni inspeccionar devoluciones', () => {
    expect(bandejaSrc).toMatch(/porRecibir\.length && role === 'warehouse'/)
    expect(bandejaSrc).toMatch(/porInspeccionar\.length && role === 'warehouse'/)
  })
})
