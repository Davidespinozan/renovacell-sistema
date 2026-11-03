// Ensayo 2 nov 2026 · la caducidad se lee como se escribe en México y se manda sin ambigüedad (AAAA-MM-DD); las filas
// repetidas del mismo lote se suman en vez de descartarse.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase', () => ({ hasSupabase: false, supabase: {} }))
import { fechaCaducidadIso, agruparLotes } from './migrationStore'

describe('fechaCaducidadIso', () => {
  it('día/mes/año mexicano (el error era leerlo como mes/día)', () => {
    expect(fechaCaducidadIso('06/07/2027')).toBe('2027-07-06')
    expect(fechaCaducidadIso('30/06/2027')).toBe('2027-06-30')
    expect(fechaCaducidadIso('1-2-27')).toBe('2027-02-01')
    expect(fechaCaducidadIso('30.06.2027')).toBe('2027-06-30')
  })
  it('ISO, nombres de mes y número de serie de Excel', () => {
    expect(fechaCaducidadIso('2027-06-30')).toBe('2027-06-30')
    expect(fechaCaducidadIso('2027/6/3')).toBe('2027-06-03')
    expect(fechaCaducidadIso('30-jun-2027')).toBe('2027-06-30')
    expect(fechaCaducidadIso('30 de junio de 2027')).toBe('2027-06-30')
    expect(fechaCaducidadIso('5 dic 2026')).toBe('2026-12-05')
    expect(fechaCaducidadIso('46568')).toBe('2027-06-30')
  })
  it('lo que no se puede leer con certeza no se adivina', () => {
    for (const v of ['', '31/02/2027', '13/13/2027', '06/2027', 'pronto', '2027-6', '99999']) expect(fechaCaducidadIso(v)).toBeNull()
  })
})

describe('agruparLotes', () => {
  it('suma filas del mismo lote y rechaza un lote con dos caducidades', () => {
    const r = agruparLotes([
      { sku: 'PEP-001', lote: 'A1', caducidad: '2027-06-30', cantidad: 10, ubicacion: '' },
      { sku: 'pep-001 ', lote: 'a1', caducidad: '2027-06-30', cantidad: 5, ubicacion: '' },
      { sku: 'PEP-002', lote: 'B', caducidad: '2027-01-01', cantidad: 3, ubicacion: '' },
      { sku: 'PEP-002', lote: 'B', caducidad: '2027-02-01', cantidad: 4, ubicacion: '' },
    ])
    expect(r.filas).toEqual([{ sku: 'PEP-001', lote: 'A1', caducidad: '2027-06-30', cantidad: 15, ubicacion: '' }])
    expect(r.conflictos.length).toBe(2)
  })
})

import { splitCsv } from '../../screens/admin/Importar'
describe('splitCsv (como lo exporta Excel)', () => {
  it('respeta comillas, comillas escapadas, BOM y punto y coma', () => {
    expect(splitCsv('AGU-1,L1,30/06/2027,"1,200",Bodega')).toEqual(['AGU-1', 'L1', '30/06/2027', '1,200', 'Bodega'])
    expect(splitCsv('"Bodega, estante 3",x')).toEqual(['Bodega, estante 3', 'x'])
    expect(splitCsv('"Dice ""hola""",y')).toEqual(['Dice "hola"', 'y'])
    expect(splitCsv('﻿SKU;Lote;Caducidad')).toEqual(['SKU', 'Lote', 'Caducidad'])
    expect(splitCsv('A;"1,5";B')).toEqual(['A', '1,5', 'B'])
  })
})
