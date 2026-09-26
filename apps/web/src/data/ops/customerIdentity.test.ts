// Blindaje server-side de Customer 360 Fase 1 (source-guards). Verifica EN EL FUENTE:
//   • resolver central + precedencia + AMBIGUOUS + authz + grants
//   • upsert_customer_contact (merge conservador, acotado)
//   • admin_approve_doctor preserva seller/organization/notas + liga prospect
//   • prospects.customer_id FK + backfills deterministas
//   • edges (register-doctor / capture-lead / meta-webhook) usan el resolver sin auto-link ambiguo
//   • createOrder resuelve customer_id del doctor
import { describe, it, expect } from 'vitest'
import rpcSrc from '../../../../../supabase/migrations/20261010120000_customer_identity.sql?raw'
import regSrc from '../../../../../supabase/functions/register-doctor/index.ts?raw'
import capSrc from '../../../../../supabase/functions/capture-lead/index.ts?raw'
import metaSrc from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import ordersSrc from '../store/ordersStore.ts?raw'

describe('resolve_customer_identity', () => {
  it('SECURITY DEFINER + search_path + solo staff/service (no doctor → sin enumeración)', () => {
    expect(rpcSrc).toMatch(/create or replace function public\.resolve_customer_identity/i)
    expect(rpcSrc).toMatch(/security definer/i)
    expect(rpcSrc).toMatch(/set search_path = public/i)
    expect(rpcSrc).toMatch(/v_is_service or v_role = any \(array\['admin','billing','pos'\]\)/)
    expect(rpcSrc).toMatch(/NO_AUTORIZADO/)
  })
  it('precedencia profile_id → external_id → email → teléfono', () => {
    const iProfile = rpcSrc.indexOf("'profile_id'")
    const iExternal = rpcSrc.indexOf("'external_id'")
    const iEmail = rpcSrc.indexOf('_norm_email(email)')
    const iPhone = rpcSrc.indexOf('_norm_phone(phone)')
    expect(iProfile).toBeGreaterThan(-1)
    expect(iExternal).toBeGreaterThan(iProfile)
    expect(iEmail).toBeGreaterThan(iExternal)
    expect(iPhone).toBeGreaterThan(iEmail)
  })
  it('duplicados (>1) o email≠teléfono → AMBIGUOUS (nunca LIMIT 1 arbitrario)', () => {
    expect(rpcSrc).toMatch(/n_email > 1 or n_phone > 1/)
    expect(rpcSrc).toMatch(/'AMBIGUOUS'/)
    expect(rpcSrc).toMatch(/email_phone_conflict/)
  })
  it('teléfono normalizado a últimos 10 (no asume unicidad de 10 dígitos)', () => {
    expect(rpcSrc).toMatch(/right\(regexp_replace\(coalesce\(p,''\),'\[\^0-9\]','','g'\), 10\)/)
  })
})

describe('upsert_customer_contact — acotado y conservador', () => {
  it('doctor solo su customer (profile_id=auth.uid) o staff', () => {
    expect(rpcSrc).toMatch(/create or replace function public\.upsert_customer_contact/i)
    expect(rpcSrc).toMatch(/profile_id = auth\.uid\(\)/)
  })
  it('merge conservador: vacío NUNCA pisa dato bueno (coalesce(nullif(...)))', () => {
    expect(rpcSrc).toMatch(/full_name\s*=\s*coalesce\(nullif\(btrim\(p_patch->>'full_name'\),''\), full_name\)/)
    expect(rpcSrc).toMatch(/phone\s*=\s*coalesce\(nullif\(btrim\(p_patch->>'phone'\),''\), phone\)/)
  })
  it('el doctor NO reasigna seller_name (solo staff)', () => {
    expect(rpcSrc).toMatch(/seller_name = case when v_role = any/)
  })
})

describe('admin_approve_doctor v2 — preservación + lazo prospect', () => {
  it('inserta seller_name y preserva meta (organization/notes)', () => {
    expect(rpcSrc).toMatch(/insert into public\.customers \(full_name, email, phone, city, source, seller_name, profile_id, meta\)/)
  })
  it('liga prospect.customer_id al aprobar (convertedDoctorId = este profile)', () => {
    expect(rpcSrc).toMatch(/update public\.prospects\s+set customer_id = v_customer/)
    expect(rpcSrc).toMatch(/meta->>'convertedDoctorId' = p_profile::text/)
  })
})

describe('esquema + backfills deterministas', () => {
  it('prospects.customer_id FK aditiva', () => {
    expect(rpcSrc).toMatch(/alter table public\.prospects add column if not exists customer_id uuid references public\.customers\(id\)/)
  })
  it('backfill prospects solo inequívoco (convertedDoctorId → profile → customer)', () => {
    expect(rpcSrc).toMatch(/update public\.prospects pr\s+set customer_id = c\.id/)
    expect(rpcSrc).toMatch(/convertedDoctorId' ~ '\^\[0-9a-fA-F-\]\{36\}\$'/)
  })
  it('backfill orders.customer_id determinista (doctor_id → único customer por profile_id)', () => {
    expect(rpcSrc).toMatch(/update public\.orders o\s+set customer_id = c\.id/)
    expect(rpcSrc).toMatch(/c\.profile_id = o\.doctor_id/)
  })
  it('grants: resolver/contact a authenticated, helpers privados, nada a anon', () => {
    expect(rpcSrc).toMatch(/grant execute on function public\.resolve_customer_identity.*to authenticated/i)
    expect(rpcSrc).toMatch(/revoke all on function public\._norm_email\(text\) from public, anon, authenticated/i)
  })
  it('NO crea constraint/índice UNIQUE de email/phone ni borra/mergea customers', () => {
    expect(rpcSrc).not.toMatch(/create unique index[^\n]*customers[^\n]*(email|phone)/i)
    expect(rpcSrc).not.toMatch(/add constraint[^\n]*unique[^\n]*(email|phone)/i)
    expect(rpcSrc).not.toMatch(/delete from public\.customers/i)
  })
})

describe('edges usan el resolver (convergencia futura)', () => {
  it('register-doctor: resuelve y guarda CANDIDATO en meta.commercial (sin auto-link)', () => {
    expect(regSrc).toMatch(/resolve_customer_identity/)
    expect(regSrc).toMatch(/commercial/)
  })
  it('capture-lead: liga prospect a customer (EXACT/MATCH) o marca review (AMBIGUOUS)', () => {
    expect(capSrc).toMatch(/resolve_customer_identity/)
    expect(capSrc).toMatch(/identity_review/)
    expect(capSrc).toMatch(/customer_id: customerId/)
  })
  it('meta-webhook: idem por teléfono', () => {
    expect(metaSrc).toMatch(/resolve_customer_identity/)
    expect(metaSrc).toMatch(/customer_id: customerId/)
  })
})

describe('createOrder — pedido Portal lleva doctor_id + customer_id', () => {
  it('resuelve el customer del doctor por profile_id y lo pasa a crear_pedido', () => {
    expect(ordersSrc).toMatch(/resolvedCustomerId/)
    expect(ordersSrc).toMatch(/from\('customers'\)\.select\('id'\)\.eq\('profile_id', doctorId/)
    expect(ordersSrc).toMatch(/p_customer_id: resolvedCustomerId/)
  })
})
