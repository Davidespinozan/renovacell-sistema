// CC-0A · Guardas de repositorio: la migración cierra las fronteras exactas, el rollback
// existe y restaura, el assistant ya no toma el catálogo del cliente, y el checkout exige
// verificación explícita. Sin llamadas reales.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261025120000_cc0a_fronteras_autoridad.sql?raw'
import down from '../../../../../supabase/rollback/cc0a/99_down.sql?raw'
import assistantSrc from '../../../../../supabase/functions/assistant/index.ts?raw'
import checkoutSrc from '../../../../../supabase/functions/stripe-checkout/index.ts?raw'
import landingSrc from '../../../public/landing/index.html?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-0A · frontera de precio', () => {
  const c = codigo(mig)
  it('puede_ver_precio() es la misma condición que products_safe, sin uid del cliente y security INVOKER', () => {
    expect(c).toMatch(/create or replace function public\.puede_ver_precio\(\) returns boolean\n\s+language sql stable set search_path = public/)
    expect(c).toMatch(/select public\.auth_role\(\) <> '' and \(public\.auth_role\(\) <> 'doctor' or public\.is_verified\(\)\)/)
    expect(c).not.toMatch(/puede_ver_precio\(p_/)
    expect(c).toMatch(/revoke all on function public\.puede_ver_precio\(\) from public, anon/)
  })
  it('product_volume_prices, product_prices y price_lists exigen la frontera; anon sin privilegio', () => {
    expect(c).toMatch(/create policy pvp_read on public\.product_volume_prices\n\s+for select to authenticated using \(public\.puede_ver_precio\(\)\)/)
    expect(c).toMatch(/create policy product_prices_read[\s\S]*?public\.puede_ver_precio\(\)\n\s+and list_id = \(select p\.price_list_id from public\.profiles p where p\.id = auth\.uid\(\)\)/)
    expect(c).toMatch(/create policy price_lists_read on public\.price_lists\n\s+for select to authenticated using \(public\.puede_ver_precio\(\)\)/)
    for (const t of ['product_volume_prices', 'product_prices', 'price_lists', 'lots']) expect(c).toContain(`revoke all on public.${t} from anon`)
  })
  it('no toca precio_de, crear_pedido, vender_pos, products_safe ni product_stock', () => {
    expect(c).not.toMatch(/function public\.(precio_de|crear_pedido|vender_pos)\b/)
    expect(c).not.toMatch(/create or replace view public\.(products_safe|product_stock)/)
  })
})

describe('migración CC-0A · vistas', () => {
  const c = codigo(mig)
  it('v_order_money: misma aritmética W2 + filtro pedido_visible (security INVOKER), sin security_invoker en la vista', () => {
    expect(c).toMatch(/create or replace function public\.pedido_visible\(p_order uuid\) returns boolean\n\s+language sql stable set search_path = public/)
    expect(c).toMatch(/select exists \(select 1 from public\.orders o where o\.id = p_order\)/)
    expect(c).toMatch(/\) cg on true\nwhere public\.pedido_visible\(o\.id\);/)
    expect(c).not.toMatch(/v_order_money set \(security_invoker/)
    // Columnas y fórmulas de W2 intactas.
    for (const f of ['as cobrado_neto', 'as saldo', "then 'refunded'", "then 'paid'", "then 'parcial'", 'as sobrepago', 'as reembolso_pendiente', 'as credito_autorizado', 'as vencido', 'as liberado', 'pe.refund_id is not null', 'cgx.revoked_at is null limit 1']) {
      expect(c).toContain(f)
    }
    expect(c).toMatch(/revoke all on public\.v_order_money from anon, public;\ngrant select on public\.v_order_money to authenticated;/)
  })
  it('v_stock_disponible pasa a security_invoker=true sin redefinirse', () => {
    expect(c).toMatch(/alter view public\.v_stock_disponible set \(security_invoker = true\)/)
    expect(c).not.toMatch(/create or replace view public\.v_stock_disponible/)
  })
})

describe('migración CC-0A · profiles_guard', () => {
  const c = codigo(mig)
  it('conserva el bloque W6-A1 íntegro y añade META_PROTEGIDA solo para no-Dirección', () => {
    for (const s of ['ACCESO_SOLO_POR_COMANDO', 'ROL_SOLO_POR_COMANDO', "if public.auth_role() = 'admin' then", 'No autorizado: no puedes modificar role_id, verified, price_list_id ni capacidades']) expect(c).toContain(s)
    const admin = c.indexOf("if public.auth_role() = 'admin' then"); const meta = c.indexOf('META_PROTEGIDA')
    expect(admin).toBeGreaterThan(0); expect(meta).toBeGreaterThan(admin)
    expect(c).toMatch(/array\['capabilities','verification','identity','verifyResult','cedula',\n\s+'commercial','owner','seller_profile_id','fromProspect','invited',\n\s+'active','baja'\]/)
  })
  it('no protege lo editable por el usuario (name, avatar_url, fiscal, shipping) ni fija verified', () => {
    const lista = c.slice(c.indexOf('v_protegidas text[]'), c.indexOf('k text;'))
    for (const k of ["'name'", "'avatar_url'", "'fiscal'", "'shipping'"]) expect(lista).not.toContain(k)
    expect(c).not.toMatch(/set verified = true/)
  })
  it('las precondiciones abortan y la verificación final abortan (sin EXCEPTION WHEN OTHERS)', () => {
    expect(c).toMatch(/raise exception 'CC0A: faltan objetos base/)
    expect(c).toMatch(/raise exception 'CC0A: anon conserva SELECT/)
    expect(c).not.toMatch(/exception when others/i)
  })
})

describe('rollback CC-0A', () => {
  const d = codigo(down)
  it('restaura las políticas, la vista W2 sin filtro, owner-run en lotes y profiles_guard W6-A1; retira las funciones', () => {
    expect(d).toMatch(/for select to authenticated using \(true\);/)
    expect(d).toMatch(/OR list_id = \(SELECT price_list_id FROM public\.profiles WHERE id = auth\.uid\(\)\)/)
    expect(d).toMatch(/\) cg on true;/)
    expect(d).not.toMatch(/pedido_visible\(o\.id\)/)
    expect(d).toMatch(/alter view public\.v_stock_disponible set \(security_invoker = false\)/)
    expect(d).toMatch(/drop function if exists public\.pedido_visible\(uuid\);\ndrop function if exists public\.puede_ver_precio\(\);/)
    expect(d).not.toMatch(/META_PROTEGIDA/)
  })
})

describe('assistant · el catálogo no viene del cliente', () => {
  const a = codigo(assistantSrc)
  it('carga catalog_public (landing) o products_safe con la RLS del llamante (doctor) en el servidor', () => {
    expect(a).toMatch(/from\('catalog_public'\)\.select\('name, line, category'\)/)
    expect(a).toMatch(/caller\.from\('products_safe'\)\.select\('name, line, category'\)\.eq\('active', true\)\.eq\('show_portal', true\)/)
    expect(a).toMatch(/system: systemPrompt\(mode, products\)/)
  })
  it('p.products ya no se lee en ninguna parte', () => {
    expect(a).not.toMatch(/p\.products/)
    expect(a).not.toMatch(/p\.catalog/)
  })
  it('la carga del catálogo ocurre DESPUÉS de resolver al llamante y no usa service_role', () => {
    const auth = a.indexOf('resolverQuien(caller'); const cat = a.indexOf("from('products_safe')")
    expect(auth).toBeGreaterThan(0); expect(cat).toBeGreaterThan(auth)
    const bloque = a.slice(a.indexOf('let products'), a.indexOf('const history'))
    expect(bloque).not.toMatch(/SERVICE_ROLE/)
  })
})

describe('stripe-checkout · UNVERIFIED CANNOT CHECKOUT', () => {
  const s = codigo(checkoutSrc)
  it('exige is_verified() del servidor para doctores, falla cerrado, antes de leer el pedido y de crear la sesión', () => {
    expect(s).toMatch(/if \(q\.quien\.role === 'doctor'\) \{\n\s+const \{ data: verificado, error: vErr \} = await caller\.rpc\('is_verified'\)\n\s+if \(vErr \|\| verificado !== true\) return json\(403, \{ error: 'NO_VERIFICADO'/)
    const gate = s.indexOf("rpc('is_verified')"); const order = s.indexOf("from('orders')"); const create = s.indexOf('stripe.checkout.sessions.create')
    expect(gate).toBeGreaterThan(s.indexOf('resolverQuien('))
    expect(order).toBeGreaterThan(gate); expect(create).toBeGreaterThan(order)
  })
})

describe('frontend · assistant', () => {
  it('UX-1 · el portal del doctor ya no tiene cliente propio del assistant; la landing pública sigue usándolo (mode landing) y el servidor ignora products', () => {
    expect(landingSrc).toMatch(/\/functions\/v1\/assistant/)
    expect(landingSrc).toMatch(/mode:\s*'landing'/)
    expect(codigo(assistantSrc)).toMatch(/mode === 'landing'/)
  })
})
