// W6-A3.1 · Guardas: la cobranza automática legacy no tiene consumidores en el frontend y la
// bandeja deriva "Por cobrar" / "Crédito vencido" del libro (v_order_money), no de sellos.
import { describe, it, expect } from 'vitest'
import bandejaSrc from '../../screens/Bandeja.tsx?raw'
import mig from '../../../../../supabase/migrations/20261024120000_w6a3_salud_cron.sql?raw'

const fuentes = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/*.test.ts', '!../../**/*.test.tsx', '!../database.types.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('cobranza automática legacy: cero consumidores', () => {
  it('ningún archivo del frontend usa avisar_cuentas_por_cobrar ni cobranza_avisada_at', () => {
    const malos = Object.entries(fuentes).filter(([, s]) => /avisar_cuentas_por_cobrar|cobranza_avisada_at/.test(s)).map(([k]) => k)
    expect(malos).toEqual([])
  })
  it('la bandeja deriva cobranza del libro', () => {
    const c = codigo(bandejaSrc)
    expect(c).toMatch(/const vencidos = dinero\.filter\(\(m\) => m\.vencido\)/)
    expect(c).toMatch(/byOrder\[o\.id\]\?\.saldo/)
    expect(c).not.toMatch(/notifications/)
  })
})

describe('migración A3.1', () => {
  const c = codigo(mig)
  it('retira la cobranza y no crea sustituto que escriba en orders', () => {
    expect(c).toMatch(/drop function if exists public\.avisar_cuentas_por_cobrar\(\)/)
    expect(c).not.toMatch(/update public\.orders/i)
    expect(c).not.toMatch(/insert into public\.orders/i)
  })
  it('el aviso de lotes usa hoy_local() y el OK se escribe después del trabajo', () => {
    expect(c).toMatch(/v_hoy date := public\.hoy_local\(\)/)
    expect(c).not.toMatch(/CURRENT_DATE/)
    const trabajo = c.indexOf('n := public.avisar_lotes_por_caducar()'); const ok = c.indexOf('set ultimo_ok = clock_timestamp()')
    expect(trabajo).toBeGreaterThan(0); expect(ok).toBeGreaterThan(trabajo)
  })
  it('la salud no construye mensajes con SQL/CONTEXT y exige Dirección', () => {
    expect(c).toMatch(/NO_AUTORIZADO: la salud del sistema es de Dirección/)
    expect(c).toMatch(/split_part\(coalesce\(r\.return_message, ''\), E'\\n', 1\)/)
  })
})
