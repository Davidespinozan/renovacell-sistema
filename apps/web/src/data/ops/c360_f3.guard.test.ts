// C360-F3 · Guardas de repositorio: tablas nuevas cerradas (RLS + sin privilegios directos), edición SOLO por
// comandos cliente_*, doctor_locations sin escritura directa, checkout congela el perfil elegido en el servidor,
// la Edge solo reenvía un uuid, el frontend no escribe tablas de cliente y el rollback deshace todo.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261104120000_c360_f3_cliente_360.sql?raw'
import down from '../../../../../supabase/rollback/c360_f3/99_down.sql?raw'
import cartSrc from '../../../../../supabase/functions/cart/index.ts?raw'
import carritoShared from '../../../../../supabase/functions/_shared/carrito.ts?raw'
import opsSrc from './customer360.ts?raw'
import storeSrc from '../store/doctorLocationsStore.ts?raw'
import paginaSrc from '../../app/Customer360.tsx?raw'
import editoresSrc from '../../app/Cliente360Editores.tsx?raw'
import autoSrc from '../../app/AutoservicioCliente.tsx?raw'
import catalogoSrc from '../../screens/doctor/Catalogo.tsx?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const TABLAS = ['customer_phones', 'customer_fiscal_profiles', 'customer_notes', 'customer_events']

describe('migración 121 (C360-F3)', () => {
  const c = codigo(mig)
  it('las 4 tablas nuevas con RLS y sin privilegios para anon/authenticated', () => {
    for (const t of TABLAS) {
      expect(c).toContain(`create table public.${t}`)
      expect(c).toContain(`alter table public.${t} enable row level security`)
    }
    expect(c).toMatch(/revoke all on public\.customer_phones, public\.customer_fiscal_profiles, public\.customer_notes, public\.customer_events from public, anon, authenticated/)
    expect(c).not.toMatch(/grant [^;]*on (table )?public\.customer_(phones|fiscal_profiles|notes|events)/)
  })
  it('doctor_locations: tipo y municipio; escritura directa revocada', () => {
    expect(c).toMatch(/revoke insert, update, delete on public\.doctor_locations from authenticated, anon/)
    expect(c).toMatch(/tipo/); expect(c).toMatch(/municipio/)
  })
  it('helpers revocados; comandos solo para authenticated', () => {
    expect(c).toMatch(/revoke all on function public\._c360_actor\(uuid\)/)
    expect(c).not.toMatch(/grant execute on function public\._c360_/)
    expect(c).not.toMatch(/grant execute on function [^;]*cliente_[^;]* to [^;]*anon/)
  })
  it('teléfonos: UNA regla de validez (valor completo, 10–15 dígitos) en migración, trigger y comando', () => {
    expect(c).toMatch(/create or replace function public\._c360_tel_valido\(p text\)/)
    expect(c).toMatch(/if not public\._c360_tel_valido\(new\.phone\) then return new/)
    expect(c).toMatch(/if not public\._c360_tel_valido\(p_numero\) then raise exception 'TELEFONO_INVALIDO/)
    expect(c).toMatch(/where public\._c360_tel_valido\(c\.phone\)/)
    expect(c).not.toMatch(/_c360_tel_norm\([^)]*\) ~ /)   // nunca truncar para declarar validez
    expect(c).not.toMatch(/\{7,15\}/)
    expect(codigo(down)).toMatch(/public\._c360_tel_valido\(text\)/)
  })
  it('vendedor: nunca fiscal ni seller_name; facturación no edita contacto', () => {
    expect(c).toMatch(/if k = 'seller_name' and a not in \('direccion', 'servicio'\) then continue/)
  })
  it('checkout: perfil elegido validado ANTES del pedido y congelado en el servidor', () => {
    expect(c).toContain('drop function public.cc_checkout_confirmar(uuid, text, integer, boolean);')
    expect(c).toMatch(/grant execute on function public\.cc_checkout_confirmar\(uuid, text, integer, boolean, uuid\) to authenticated, service_role/)
    const i = c.indexOf('PERFIL_FISCAL_INVALIDO'), j = c.indexOf('set_order_fiscal_snapshot(v_order, v_fiscal)')
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i)
  })
})

describe('rollback C360-F3', () => {
  const d = codigo(down)
  it('quita tablas, trigger, comandos y columnas; restaura la firma de 4 y la escritura previa de ubicaciones', () => {
    expect(d).toMatch(/drop trigger if exists trg_customers_phone_c360/)
    expect(d).toMatch(/drop table if exists public\.customer_events, public\.customer_notes, public\.customer_fiscal_profiles, public\.customer_phones/)
    expect(d).toMatch(/drop function if exists public\.cc_checkout_confirmar\(uuid, text, integer, boolean, uuid\)/)
    expect(d).toMatch(/grant execute on function public\.cc_checkout_confirmar\(uuid, text, integer, boolean\) to authenticated, service_role/)
    expect(d).toMatch(/drop column if exists tipo, drop column if exists municipio/)
    expect(d).toMatch(/grant insert, update, delete on public\.doctor_locations to authenticated/)
  })
})

describe('Edge cart', () => {
  it('reenvía SOLO un uuid de perfil y solo si pide factura; mapea el error a 409', () => {
    expect(cartSrc).toMatch(/const perfil = factura && typeof p\.perfil_fiscal_id === 'string' && UUID\.test\(p\.perfil_fiscal_id\) \? p\.perfil_fiscal_id : null/)
    expect(cartSrc).toMatch(/p_perfil_fiscal: perfil/)
    expect(cartSrc).not.toMatch(/p_fiscal\b|rfc|razon_social/)
    expect(carritoShared).toMatch(/PERFIL_FISCAL_INVALIDO[\s\S]*409/)
  })
})

describe('frontend: solo comandos, sin escrituras directas', () => {
  const directa = /\.from\(['"](customers|customer_phones|customer_fiscal_profiles|customer_notes|customer_events|doctor_locations)['"]\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/
  it('ops, store, página, editores y autoservicio', () => {
    for (const s of [opsSrc, storeSrc, paginaSrc, editoresSrc, autoSrc]) expect(codigo(s)).not.toMatch(directa)
    for (const fn of ['cliente_ubicacion_guardar', 'cliente_ubicacion_archivar', 'cliente_ubicacion_predeterminar']) expect(storeSrc).toContain(fn)
  })
  it('el catálogo ya no congela el receptor desde el navegador', () => {
    expect(codigo(catalogoSrc)).not.toMatch(/setOrderFiscalSnapshot/)
  })
})
