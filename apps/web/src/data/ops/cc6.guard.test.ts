// CC-6 · Guardas de repositorio: el pedido nace SOLO por crear_pedido (W1) dentro de la misma
// transacción que convierte el carrito y consume la revisión; corre como el dueño autenticado;
// sin pagos/CFDI/inventario; la Edge manda solo review_id/operation_id/rev; la IA no confirma;
// el catálogo legacy sigue intacto (deferido con razón); el rollback restaura la guarda CC-4.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261101120000_cc6_checkout.sql?raw'
import down from '../../../../../supabase/rollback/cc6/99_down.sql?raw'
import cartSrc from '../../../../../supabase/functions/cart/index.ts?raw'
import limiteSrc from '../../../../../supabase/functions/_shared/limite.ts?raw'
import herSrc from '../../../../../supabase/functions/_shared/ia/herramientas.ts?raw'
import valSrc from '../../../../../supabase/functions/_shared/ia/validacion.ts?raw'
import polSrc from '../../../../../supabase/functions/_shared/ia/politica.ts?raw'
import opsSrc from './carrito.ts?raw'
import panelSrc from '../../screens/chat/CarritoPanel.tsx?raw'
import catalogoLegacy from '../../screens/doctor/Catalogo.tsx?raw'
import motorSrc from '../../screens/checkout/checkoutMotor.ts?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-6', () => {
  const c = codigo(mig)
  it('CHK5/14 · identidad = auth.uid() y rol doctor; un review_id conocido no da acceso; revisar/confirmar solo authenticated', () => {
    expect(c).toMatch(/declare v_uid uuid := auth\.uid\(\);/)
    expect(c).toMatch(/if v_rol <> 'doctor' then raise exception 'NO_AUTORIZADO: el checkout es del doctor dueño/)
    expect(c).toMatch(/if not found or r\.profile_id <> v_uid then raise exception 'NO_AUTORIZADO'/)
    expect(c).toMatch(/grant execute on function public\.cc_checkout_revisar\(uuid, uuid\), public\.cc_checkout_confirmar\(uuid, text, int\) to authenticated;/)
    expect(c).not.toMatch(/to anon|to service_role/)
  })
  it('CHK17–22 · confirmar revalida TODO (precio por cc_ia_precio, disponibilidad, visibilidad) y rechaza CARRITO_CAMBIO / PRECIO_CAMBIO / NO_LISTO / REVISION_EXPIRADA', () => {
    expect(c).toMatch(/lin := public\._cc_chk_lineas\(c\.id, v_uid\);/)
    expect(c).toMatch(/pr := public\.cc_ia_precio\(p_profile, it\.product_id, it\.quantity\);/)
    expect(c).toMatch(/if r\.cart_rev <> c\.rev or \(p_expected_rev is not null and p_expected_rev <> c\.rev\) then/)
    expect(c).toMatch(/if lin ->> 'fingerprint' <> r\.fingerprint then/)
    for (const m of ['CARRITO_CAMBIO', 'PRECIO_CAMBIO', 'NO_LISTO', 'REVISION_EXPIRADA', 'REVISION_CONSUMIDA']) expect(c).toContain(`'motivo', '${m}'`)
    expect(c).toMatch(/interval '15 minutes'/)
  })
  it('CHK20/23–29 · el pedido nace SOLO por crear_pedido, en la misma transacción que converted + revisión consumida + operación; retry → mismo pedido; convertido → nunca otro', () => {
    expect(c).toMatch(/w1 := public\.crear_pedido\(v_order, null, v_uid,/)   // folio del servidor (D-CC6-11)
    expect(c).not.toMatch(/'SC' \|\|/); expect(c).toMatch(/'source', 'cc_checkout'/)
    expect(c).toMatch(/v_seller := public\._cc_chk_seller\(v_uid\);/)   // D-15: vendedor derivado del servidor como metadata
    expect(c).not.toMatch(/insert into public\.orders|insert into public\.order_items/)
    expect(c).toMatch(/update public\.cc_carts set estado = 'converted', converted_order_id = v_order/)
    expect(c).toMatch(/update public\.cc_checkout_reviews set consumed_at = now\(\), order_id = v_order where id = r\.id;/)
    expect(c).toMatch(/insert into public\.cc_checkout_operations \(cart_id, operation_id, profile_id, review_id, order_id, resultado\)/)
    expect(c).toMatch(/if op\.review_id <> r\.id then raise exception 'IDEMPOTENCIA_CONFLICTO'/)
    expect(c).toMatch(/if c\.estado = 'converted' then return public\._cc_chk_resultado\(c\.converted_order_id, c\.id, true\)/)
    expect(c).toMatch(/constraint ck_ccop_status check \(status in \('completed'\)\)/)
  })
  it('CHK30–36 · sin pagos, CFDI, inventario ni crédito; precio nunca persistido como autoridad', () => {
    const conf = c.slice(c.indexOf('create or replace function public.cc_checkout_confirmar'), c.indexOf('revoke all on function public.cc_checkout_revisar'))
    expect(conf).not.toMatch(/payment_entries|registrar_cobro|set payment_status|cfdi|kardex|lots\.quantity|credit_grants/)
    expect(c).toMatch(/fingerprint\s+text not null,\s+-- huella/)
  })
  it('guarda CC-4 extendida con bandera interna de transacción; el rollback restaura el texto CC-4', () => {
    expect(c).toMatch(/coalesce\(current_setting\('app\.cc_interno', true\), ''\) <> 'on'/)
    expect(c).toMatch(/perform set_config\('app\.cc_interno', 'on', true\);/)
    const d = codigo(down)
    expect(d).toMatch(/create or replace function public\._cc_solo_servicio\(\)/); expect(d).not.toMatch(/app\.cc_interno/)
    expect(d).not.toMatch(/orders|cc_carts/)
  })
})

describe('Edge cart + IA + frontend', () => {
  it('AM · revisar/confirmar exigen JWT y corren como el llamante; el cliente manda solo review_id/operation_id/expected_cart_rev; límites CC-0B', () => {
    const s = codigo(cartSrc)
    expect(s).toMatch(/if \(!quien\) return json\(401, \{ error: 'sin_identidad', message: 'Para confirmar tu pedido/)
    expect(s).toMatch(/await caller\.rpc\('cc_checkout_confirmar', \{ p_review: review, p_operation: opc, p_expected_rev: rev, p_factura: factura, p_perfil_fiscal: perfil \}\)/)   // CC-7 · factura; C360-F3 · perfil elegido (solo id)
    expect(s).toMatch(/const factura = p\.factura === true/)
    expect(s).not.toMatch(/admin\.rpc\('cc_checkout/)
    expect(s).not.toMatch(/p\.total|p\.price|p\.precio|p\.discount|p\.price_list|p\.doctor|p\.customer|p\.seller/)
    for (const sc of ['checkout_revisar_uid', 'checkout_confirmar_uid', 'checkout_global']) { expect(s).toContain(`'${sc}'`); expect(codigo(limiteSrc)).toContain(`${sc}:`) }
  })
  it('Y/Z · la IA solo tiene preparar_checkout (lectura); no hay confirmar; "pedido creado" bloqueado; política explícita', () => {
    const h = codigo(herSrc)
    expect(h).toContain("name: 'preparar_checkout'"); expect(h).not.toContain("name: 'confirmar_checkout'")
    expect(codigo(valSrc)).toMatch(/if \(RE_PEDIDO_CREADO\.test\(t\)\) return \{ ok: false, motivo: 'pedido_sin_evidencia' \}/)
    expect(codigo(polSrc)).toMatch(/NUNCA afirmas que un pedido fue creado/)
  })
  it('AD · UI: revisión → botón "Confirmar pedido" → pedido → pago DESPUÉS; mismo operation_id en reintentos; Stripe solo si el usuario elige', () => {
    const p = codigo(panelSrc)
    expect(p).toMatch(/data-testid="checkout-confirmar">Confirmar pedido<\/button>/)
    expect(p).toMatch(/await cliente\.confirmarCheckout\(revision\.review_id, revision\.cart_rev, opConfirmar\)/)
    expect(p).toMatch(/onClick=\{\(\) => void startStripeCheckout\(pedido\.order_id!\)\}/)
    expect(p).not.toMatch(/crear_pedido|createOrder|supabase\./)
    expect(codigo(opsSrc)).toMatch(/confirmarCheckout\(review_id: string, expected_cart_rev: number, operation_id = nuevaOperacion\(\), factura = false, perfil_fiscal_id: string \| null = null\)/)
  })
  it('AC · CC-7/C360-F3 · el Catálogo confirma por el checkout CANÓNICO con snapshot de dirección y el PERFIL FISCAL elegido (lo congela el servidor)', () => {
    // MC-1 · el Catálogo monta el checkout CANÓNICO compartido; la revisión manda id de ubicación o snapshot de
    // dirección, y la confirmación lleva la clave del INTENTO (revisión + factura + perfil), no una nueva por clic.
    expect(catalogoLegacy).toMatch(/<CheckoutCanonico[\s\S]*servidor=\{servidor\}/)
    expect(motorSrc).toMatch(/return \[e\?\.locationId \?\? null, e\?\.locationId \? null : e\?\.address \?\? null\]/)
    expect(motorSrc).toMatch(/await cliente\.revisarCheckout\(cartId, \.\.\.argsRevision\(e\)\)/)
    expect(motorSrc).toMatch(/await cliente\.confirmarCheckout\(rv\.review_id, rv\.cart_rev, op, factura, factura \? perfilFiscalId : null\)/)
    expect(codigo(motorSrc)).not.toMatch(/cc_checkout_|supabase\.|crear_pedido/)
    expect(catalogoLegacy).not.toMatch(/setOrderFiscalSnapshot/)   // ya no hay snapshot posterior desde el navegador
    expect(catalogoLegacy).not.toMatch(/cc_checkout_|supabase\.rpc/)
  })
})
