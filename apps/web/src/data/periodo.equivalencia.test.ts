// W5 · EQUIVALENCIA con el servidor. Lee los vectores de supabase/tests/db/tests/w5_00_reloj.sql
// (los mismos que ejecuta Postgres con `dia_negocio`) y exige que `diaNegocio` dé lo mismo.
// Si alguien cambia la zona o la regla en un solo lado, esta prueba o la de la base fallan.
import { describe, it, expect } from 'vitest'
import sql from '../../../../supabase/tests/db/tests/w5_00_reloj.sql?raw'
import migracion from '../../../../supabase/migrations/20261022120000_w5_kpis.sql?raw'
import { diaNegocio, ZONA_NEGOCIO } from './periodo'

const bloque = sql.slice(sql.indexOf('-- VECTORES:INICIO'), sql.indexOf('-- VECTORES:FIN'))
const vectores = [...bloque.matchAll(/\('([^']+)'::timestamptz,\s*'(\d{4}-\d{2}-\d{2})'::date,\s*'([^']*)'\)/g)]
  .map((m) => ({ ts: m[1], dia: m[2], nota: m[3] }))

describe('diaNegocio ⇔ dia_negocio (servidor)', () => {
  it('se leyeron los vectores del archivo de la base', () => {
    expect(vectores.length).toBeGreaterThanOrEqual(16)
  })
  for (const v of vectores) {
    it(`${v.nota} (${v.ts} → ${v.dia})`, () => {
      expect(diaNegocio(v.ts)).toBe(v.dia)
    })
  }
  it('la zona declarada en el servidor y en el navegador es la misma', () => {
    expect(migracion).toMatch(/create function public\.dia_negocio\(p_instante timestamptz\)[\s\S]*?at time zone 'America\/Mazatlan'/)
    expect(ZONA_NEGOCIO).toBe('America/Mazatlan')
  })
})
