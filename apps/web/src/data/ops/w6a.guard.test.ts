// W6-A1 · Guardas de repositorio sobre la migración y el frontend.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261023120000_w6a_staff_suspension.sql?raw'
import down from '../../../../../supabase/rollback/w6a/99_down.sql?raw'
import teamSrc from '../store/teamStore.ts?raw'
import authSrc from '../../auth/supabaseAuth.ts?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')

describe('migración W6-A1', () => {
  const c = codigo(mig)
  it('active es columna NOT NULL default true', () => { expect(c).toMatch(/add column active boolean not null default true/) })
  it('el traslado desde meta.active nunca toca doctores', () => { expect(c).toMatch(/role_id is distinct from 'doctor'\s+and \(meta ->> 'active'\) = 'false'/) })
  it('auth_role() falla cerrado llamando a _cuenta_suspendida() solo si no está activo', () => {
    expect(c).toMatch(/case when p\.active then p\.role_id else public\._cuenta_suspendida\(\) end/)
  })
  it('has_cap e is_verified exigen active', () => {
    expect(c).toMatch(/select p\.active and \(\(p\.meta -> 'capabilities'\) \? cap\)/)
    expect(c).toMatch(/select p\.active and p\.verified/)
  })
  it('active y role_id solo cambian por comando (antes de la excepción de Dirección)', () => {
    const i = c.indexOf('ACCESO_SOLO_POR_COMANDO'); const j = c.indexOf("if public.auth_role() = 'admin' then")
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i)
  })
  it('el comando prohíbe la autosuspensión y rechaza doctores', () => {
    expect(c).toMatch(/AUTOSUSPENSION_PROHIBIDA/); expect(c).toMatch(/SOLO_STAFF/)
  })
  it('no borra: ninguna sentencia delete sobre profiles ni auth.users', () => {
    expect(c).not.toMatch(/delete from public\.profiles|delete from auth\.users|deleteUser/i)
  })
  it('no toca comandos de W1–W5', () => {
    expect(c).not.toMatch(/function public\.(recibir_lote|surtir_pedido|vender_pos|registrar_cobro|solicitar_cfdi|comm_reclamar|kpi_)/)
  })
})

describe('rollback W6-A1', () => {
  const c = codigo(down)
  it('aborta si hay suspendidos', () => { expect(c).toMatch(/ROLLBACK_ABORTADO/) })
  it('restaura auth_role al texto anterior', () => { expect(c).toMatch(/select coalesce\(\(select role_id from public\.profiles where id = auth\.uid\(\)\), ''\);/) })
})

describe('frontend', () => {
  it('teamStore ya no escribe meta.active ni lo lee como autoridad', () => {
    const t = teamSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(t).not.toMatch(/writeMeta\(id, \{ active \}\)/)
    expect(t).not.toMatch(/meta\.active/)
    expect(t).toMatch(/active: p\.active !== false/)
  })
  it('la sesión lee active y trata la suspensión', () => {
    expect(authSrc).toMatch(/select\('role_id, verified, full_name, meta, active'\)/)
    expect(authSrc).toMatch(/if \(data\.active === false\) return 'suspendida'/)
  })
})
