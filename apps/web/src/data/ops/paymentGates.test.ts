// Blindaje server-side del dinero. Verifica EN EL FUENTE que:
//  - el CFDI no se timbra sin pago (gate real, no solo el front),
//  - report-transfer DECLARA el pago con el comando (no lo cobra ni lo escribe a mano),
//  - el webhook de Stripe registra el cobro en el LIBRO, idempotente,
//  - los comandos de W2 son SECURITY DEFINER con autoridad y estados correctos,
//  - el surtido se libera por COBRO O CRÉDITO, sin fingir 'paid',
//  - ningún actor (Dirección incluida) puede editar los campos de dinero del pedido.
// Sin llamadas reales a la base ni a las Edge Functions.
import { describe, it, expect } from 'vitest'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'
import { puedeTimbrar } from '../../../../../supabase/functions/cfdi/rules'
import reportSrc from '../../../../../supabase/functions/report-transfer/index.ts?raw'
import stripeSrc from '../../../../../supabase/functions/stripe-webhook/index.ts?raw'
import n1Src from '../../../../../supabase/migrations/20261013120000_w2_n1_schema.sql?raw'
import n2Src from '../../../../../supabase/migrations/20261013120100_w2_n2_constraints.sql?raw'
import n3Src from '../../../../../supabase/migrations/20261013120200_w2_n3_commands.sql?raw'
import n4Src from '../../../../../supabase/migrations/20261013120300_w2_n4_authority.sql?raw'
import cierreSrc from '../../screens/admin/CierreCaja.tsx?raw'

// W3-A · El gate de pago ya no vive dentro de la Edge Function (que fue CONTENIDA y no
// puede llegar al PAC): vive como regla pura y probada en cfdi/rules.ts, lista para que
// W3-B la aplique sobre la intención durable. El gate no se debilitó — se movió, y además
// ahora es imposible timbrar desde ahí, con o sin pago.
describe('GATE CFDI · no se timbra un pedido sin pagar', () => {
  it('la regla existe, es pura y exige pago confirmado', () => {
    expect(puedeTimbrar({ payment_status: 'paid' })).toEqual({ ok: true })
    expect(puedeTimbrar({ payment_status: 'pending' })).toMatchObject({ ok: false, error: 'unpaid' })
    expect(puedeTimbrar({ payment_status: 'partial' })).toMatchObject({ ok: false, error: 'unpaid' })
    expect(puedeTimbrar({})).toMatchObject({ ok: false, error: 'unpaid' })
  })
  it('el mensaje al operador se conserva', () => {
    const r = puedeTimbrar({ payment_status: 'pending' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('El pedido debe estar pagado antes de facturarse.')
  })
  it('y la función que timbraba ya no puede hacerlo, pagado o no', () => {
    expect(cfdiSrc).not.toMatch(/fetch\s*\(/)
    expect(cfdiSrc).toMatch(/w3_contencion/)
  })
})

describe('report-transfer · declara, no cobra', () => {
  it('pasa por el comando reportar_pago', () => {
    expect(reportSrc).toMatch(/rpc\('reportar_pago'/)
  })
  it('ejecuta el comando con el JWT DEL LLAMANTE (autoría y dueño reales)', () => {
    // El service role solo sube el comprobante y notifica; el comando va como el cliente.
    expect(reportSrc).toMatch(/caller\.rpc\('reportar_pago'/)
    expect(reportSrc).not.toMatch(/admin\.rpc\('reportar_pago'/)
  })
  it('NO escribe payment_status ni shipping_meta.transfer (una sola verdad)', () => {
    expect(reportSrc).not.toMatch(/payment_status:/)
    expect(reportSrc).not.toMatch(/meta\.transfer\s*=/)
    expect(reportSrc).not.toMatch(/payment_method:/)
  })
  it('es idempotente por op_id (un reintento no crea dos comprobantes)', () => {
    expect(reportSrc).toMatch(/p_op_id/)
    expect(reportSrc).toMatch(/body\.opId/)
  })
  it('solo avisa a Dirección cuando la declaración es NUEVA', () => {
    expect(reportSrc).toMatch(/estado === 'applied'/)
  })
  it('sigue subiendo el comprobante al bucket privado con service role', () => {
    expect(reportSrc).toMatch(/storage\.from\('proofs'\)/)
  })
})

describe('stripe-webhook · el cobro entra al libro', () => {
  it('registra el cobro con el comando, no editando el pedido', () => {
    expect(stripeSrc).toMatch(/rpc\('registrar_cobro'/)
    expect(stripeSrc).not.toMatch(/payment_status: 'paid'/)
  })
  it('op_id DERIVADO de la sesión: un reintento de Stripe no cobra dos veces', () => {
    expect(stripeSrc).toMatch(/opIdDeSesion/)
    expect(stripeSrc).toMatch(/SHA-256/)
  })
  it('deja external_ref = id de sesión (segunda capa de idempotencia en el libro)', () => {
    expect(stripeSrc).toMatch(/p_reference: session\.id/)
  })
  it("solo mueve status a 'paid' si el LIBRO dice que quedó pagado", () => {
    // El status se avanza a partir de lo que devolvió el comando, no de lo que dijo Stripe.
    const i = stripeSrc.indexOf("status: 'paid'")
    expect(i).toBeGreaterThan(-1)
    expect(stripeSrc.slice(Math.max(0, i - 400), i)).toMatch(/\?\.payment_status === 'paid'/)
  })
  it('sigue verificando la firma antes de tocar nada', () => {
    const firma = stripeSrc.indexOf('constructEventAsync')
    const cobro = stripeSrc.indexOf("rpc('registrar_cobro'")
    expect(firma).toBeGreaterThan(-1)
    expect(cobro).toBeGreaterThan(firma)
  })
})

describe('W2 · el libro es la única puerta del dinero', () => {
  it('payment_entries solo se escribe por el helper de asiento', () => {
    expect(n1Src).toMatch(/payment_entries/)
    // Append-only: sin UPDATE ni DELETE (se corrige por reversa).
    expect(n1Src).toMatch(/ledger_append_only/)
  })
  it('un egreso real nace de un reembolso autorizado o es una reversa', () => {
    expect(n2Src).toMatch(/ck_entry_egreso_autorizado/)
    expect(n2Src).toMatch(/direction <> 'out' or reversal_of is not null or refund_id is not null/)
  })
  it('un reembolso autorizado se paga UNA sola vez', () => {
    expect(n2Src).toMatch(/uq_entry_refund_pagado/)
  })
  it('un pedido no puede tener dos comprobantes en cola', () => {
    expect(n2Src).toMatch(/uq_claim_abierta/)
  })
  it('un pedido no puede tener dos créditos vigentes', () => {
    expect(n2Src).toMatch(/uq_credit_vigente/)
  })
  it('payment_status queda en vocabulario cerrado y solo financiero', () => {
    expect(n2Src).toMatch(/ck_orders_payment_status/)
    expect(n2Src).toMatch(/'pending','parcial','paid','refunded','failed'/)
  })
})

describe('W2 · comandos: autoridad y máquina de estados', () => {
  const definer = (fn: string) => {
    const i = n3Src.indexOf(`create function public.${fn}(`)
    expect(i, `${fn} debe existir`).toBeGreaterThan(-1)
    const cuerpo = n3Src.slice(i, i + 900)
    expect(cuerpo).toMatch(/security definer/i)
    expect(cuerpo).toMatch(/set search_path = public/i)
  }
  it('todos los comandos de dinero son SECURITY DEFINER con search_path fijo', () => {
    ;['reportar_pago', 'revisar_pago', 'registrar_cobro', 'autorizar_reembolso', 'pagar_reembolso',
      'autorizar_credito', 'revocar_credito', 'reversar_asiento', 'registrar_corte_caja', 'anular_corte_caja']
      .forEach(definer)
  })
  it('revisar un comprobante es solo de Dirección/Facturación', () => {
    const i = n3Src.indexOf('create function public.revisar_pago(')
    expect(n3Src.slice(i, i + 800)).toMatch(/auth_role\(\)\s*=\s*any\s*\(array\['admin','billing'\]\)/i)
  })
  it('verificar/rechazar es idempotente y no cambia de opinión', () => {
    expect(n3Src).toMatch(/already_verified/)
    expect(n3Src).toMatch(/already_rejected/)
    expect(n3Src).toMatch(/YA_VERIFICADO/)              // no se rechaza lo ya verificado
    expect(n3Src).toMatch(/DECLARACION_RECHAZADA/)      // no se verifica lo ya rechazado
  })
  it('solo Dirección autoriza y revoca crédito', () => {
    const a = n3Src.indexOf('create function public.autorizar_credito(')
    expect(n3Src.slice(a, a + 600)).toMatch(/auth_role\(\) <> 'admin'/)
    const r = n3Src.indexOf('create function public.revocar_credito(')
    expect(n3Src.slice(r, r + 400)).toMatch(/auth_role\(\) <> 'admin'/)
  })
  it('el ESPERADO del corte de caja lo calcula el servidor, no el cliente', () => {
    const i = n3Src.indexOf('create function public.registrar_corte_caja(')
    const cuerpo = n3Src.slice(i, i + 3000)
    expect(cuerpo).toMatch(/v_esperado := public\._w2_efectivo_tramo\(/)
    expect(cuerpo).not.toMatch(/p_esperado/)
    // Ni fechas del cliente: el tramo se fija con el reloj del servidor.
    expect(cuerpo).toMatch(/v_hasta := clock_timestamp\(\)/)
  })
  it('un corte con diferencia exige motivo', () => {
    expect(n3Src).toMatch(/MOTIVO_REQUERIDO: hay una diferencia/)
  })
  it('las firmas viejas se ELIMINAN (el frontend viejo falla cerrado)', () => {
    expect(n3Src).toMatch(/drop function if exists public\.review_transfer_payment/)
    expect(n3Src).toMatch(/drop function if exists public\.registrar_devolucion/)
  })
})

describe('W2 · liberar para surtir = cobro O crédito (sin fingir "paid")', () => {
  it('la liberación se DERIVA del libro, no de una columna cacheada', () => {
    expect(n3Src).toMatch(/create or replace function public\.pedido_liberado_para_surtir/)
    expect(n1Src).toMatch(/as\s+liberado/)
  })
  it('surtir_pedido exige la liberación derivada y ya no exige payment_status', () => {
    const i = n3Src.indexOf('create or replace function public.surtir_pedido(')
    const cuerpo = n3Src.slice(i, i + 2500)
    expect(cuerpo).toMatch(/if not public\.pedido_liberado_para_surtir\(p_order\) then/)
    expect(cuerpo).toMatch(/PEDIDO_NO_LIBERADO/)
    // Ya no LEE payment_status para decidir (solo lo menciona un comentario).
    const codigo = cuerpo.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(codigo).not.toMatch(/payment_status/)
  })
  it('un crédito NO escribe payment_status ni status del pedido', () => {
    const i = n3Src.indexOf('create function public.autorizar_credito(')
    const cuerpo = n3Src.slice(i, i + 1600)
    expect(cuerpo).toMatch(/insert into public\.credit_grants/)
    expect(cuerpo).not.toMatch(/update public\.orders/)
  })
  it('payment_status se recalcula SOLO desde los asientos', () => {
    const i = n3Src.indexOf('create or replace function public._w2_recalc_payment_status')
    const cuerpo = n3Src.slice(i, i + 700)
    expect(cuerpo).toMatch(/select estado_pago into v_estado from public\.v_order_money/)
  })
})

describe('W2 · nadie edita el dinero del pedido a mano', () => {
  it('orders_guard bloquea los campos financieros para TODOS los roles', () => {
    expect(n4Src).toMatch(/PAGO_SOLO_POR_COMANDO/)
    expect(n4Src).toMatch(/NEW\.payment_status IS DISTINCT FROM OLD\.payment_status/)
    expect(n4Src).toMatch(/NEW\.stripe_payment_id IS DISTINCT FROM OLD\.stripe_payment_id/)
  })
  it('el bloqueo financiero va ANTES del atajo de Dirección', () => {
    const bloqueo = n4Src.indexOf('NEW.payment_status IS DISTINCT FROM OLD.payment_status')
    const atajo = n4Src.indexOf("IF r = 'admin' THEN RETURN NEW; END IF;")
    expect(bloqueo).toBeGreaterThan(-1)
    expect(atajo).toBeGreaterThan(bloqueo)
  })
  it('el doctor no puede fabricar su declaración en shipping_meta', () => {
    expect(n4Src).toMatch(/NEW\.shipping_meta -> 'transfer' IS DISTINCT FROM OLD\.shipping_meta -> 'transfer'/)
  })
  it('pay_order queda revocado (lo reemplazan registrar_cobro y autorizar_credito)', () => {
    expect(n4Src).toMatch(/revoke\s+all\s+on\s+function\s+public\.pay_order/i)
  })
  it('cash_closings pierde la escritura directa y el DELETE', () => {
    expect(n4Src).toMatch(/drop policy if exists cash_closings_all on public\.cash_closings/i)
    expect(n4Src).toMatch(/revoke insert, update, delete, truncate on public\.cash_closings/i)
  })
})

describe('W2 · D-W2-CASH-CUTOFF · un corte cerrado establece un límite económico', () => {
  it('cada corte guarda el TRAMO que reclama y a quién continúa', () => {
    expect(n1Src).toMatch(/add column corte_desde\s+timestamptz/)
    expect(n1Src).toMatch(/add column corte_hasta\s+timestamptz/)
    expect(n1Src).toMatch(/add column prev_closing_id\s+uuid/)
    expect(n1Src).toMatch(/add column cajero\s+uuid/)
  })
  it('dos cortes no pueden reclamar el mismo tramo (índices de cadena)', () => {
    expect(n2Src).toMatch(/create unique index uq_cierre_cadena on public\.cash_closings\(prev_closing_id\)/)
    expect(n2Src).toMatch(/create unique index uq_cierre_cadena_inicio/)
  })
  it('un tramo nunca es vacío ni invertido, y todo corte real lo declara', () => {
    expect(n2Src).toMatch(/constraint ck_cierre_tramo\n/)
    expect(n2Src).toMatch(/corte_hasta > corte_desde/)
    expect(n2Src).toMatch(/ck_cierre_tramo_presente/)
  })
  it('el alcance por cajero siempre identifica a su cajero (cadenas separadas)', () => {
    expect(n2Src).toMatch(/ck_cierre_cajero/)
    expect(n2Src).toMatch(/\(alcance = 'cajero'\) = \(cajero is not null\)/)
  })
  it('el esperado se calcula SOLO con movimientos posteriores al último corte válido', () => {
    const i = n3Src.indexOf('create function public._w2_efectivo_tramo(')
    const cuerpo = n3Src.slice(i, i + 700)
    expect(cuerpo).toMatch(/e\.created_at\s*>\s*p_desde/)
    expect(cuerpo).toMatch(/e\.created_at\s*<=\s*p_hasta/)
  })
  it('un corte ANULADO no establece el límite: su tramo se reabre', () => {
    const i = n3Src.indexOf('create function public._w2_corte_desde(')
    const cuerpo = n3Src.slice(i, i + 1200)
    expect(cuerpo).toMatch(/if v_cola\.voids_closing_id is not null then/)
    expect(cuerpo).toMatch(/return v_anulado\.corte_desde/)
  })
  it('la anulación entra a la cadena y solo aplica al corte más reciente', () => {
    const i = n3Src.indexOf('create function public.anular_corte_caja(')
    const cuerpo = n3Src.slice(i, i + 2600)
    expect(cuerpo).toMatch(/CORTE_NO_ES_EL_ULTIMO/)
    expect(cuerpo).toMatch(/prev_closing_id\)/)     // la anulación se encadena
    expect(cuerpo).not.toMatch(/delete from public\.cash_closings/)
  })
  it('la carrera de dos cortes simultáneos se serializa en el servidor', () => {
    const i = n3Src.indexOf('create function public.registrar_corte_caja(')
    expect(n3Src.slice(i, i + 3000)).toMatch(/pg_advisory_xact_lock\(hashtext\('w2_corte:'/)
  })
  it('los asientos se sellan con clock_timestamp: dos de la misma transacción caen en tramos distintos', () => {
    expect(n1Src).toMatch(/created_at\s+timestamptz not null default clock_timestamp\(\)/)
  })
  it('la conciliación recalcula el TRAMO de cada corte vigente (detecta lo que aterriza tarde)', () => {
    expect(n3Src).toMatch(/D8_corte_vs_libro/)
    expect(n3Src).toMatch(/public\._w2_efectivo_tramo\(c\.corte_desde, c\.corte_hasta, c\.alcance, c\.cajero\)/)
  })
  it('el efectivo en caja no es información para todos', () => {
    const i = n3Src.indexOf('create function public.efectivo_esperado(')
    expect(n3Src.slice(i, i + 900)).toMatch(/auth_role\(\) = any \(array\['admin','billing','pos'\]\)/)
    expect(n3Src).toMatch(/public\._w2_corte_cola\(text, uuid\),[\s\S]{0,200}from public, anon, authenticated/)
  })
  it('el frontend NO resta cortes previos: pide el tramo al servidor', () => {
    expect(cierreSrc).toMatch(/tramoCorteCaja\(/)
    expect(cierreSrc).not.toMatch(/esperado\s*-\s*yaArqueado/)
  })
})
