// CC-7 · Guardas de contrato (código fuente): el handoff nace SOLO en la mutación canónica del carrito
// y nunca rompe al carrito; la cartera es la única autoridad de ruteo y atribución; el cliente no
// elige vendedor ni fabrica estados; la IA no promete atención humana sin evidencia del servidor;
// el Catálogo/Asistente no mantienen un segundo carrito con backend.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261102120000_cc7_handoff_comercial.sql?raw'
import down from '../../../../../supabase/rollback/cc7/99_down.sql?raw'
import chatSrc from '../../../../../supabase/functions/chat/index.ts?raw'
import cartSrc from '../../../../../supabase/functions/cart/index.ts?raw'
import chatShared from '../../../../../supabase/functions/_shared/chat.ts?raw'
import orqSrc from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'
import valSrc from '../../../../../supabase/functions/_shared/ia/validacion.ts?raw'
import atencionSrc from './atencion.ts?raw'
import hookSrc from '../hooks/useCarritoCanonico.ts?raw'
import catalogoSrc from '../../screens/doctor/Catalogo.tsx?raw'
import lanzadorSrc from '../../app/ChatFlotante.tsx?raw'
import bandejaSrc from '../../screens/Bandeja.tsx?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const c = codigo(mig)

describe('migración 119', () => {
  it('14/19 · el handoff nace en _cc_cart_mutar (vacío → primer artículo o pendiente), un ciclo por carrito, en SAVEPOINT', () => {
    expect(c).toMatch(/if n_despues > 0 and \(primera or c\.handoff_estado = 'pendiente'\) and coalesce\(c\.handoff_estado, ''\) not in \('solicitado', 'rechazado'\) then\n\s+begin\n\s+h := public\._cc_handoff_carrito\(p_cart\);\n\s+exception when others then/)
    expect(c).toMatch(/update public\.cc_carts set handoff_estado = 'pendiente', handoff_error = v_err where id = p_cart;/)
    expect(c).toMatch(/if k\.handoff_estado in \('solicitado', 'rechazado'\) then return jsonb_build_object\('estado', k\.handoff_estado, 'idempotente', true\); end if;/)
    expect(c).toMatch(/perform public\._cc_sistema\(v_conv, public\._cc_texto_handoff\(v_conf, v_en\), 'sys:handoff:' \|\| p_cart::text\);/)
  })
  it('orden de locks dueño → carrito → conversación (advisory por perfil en carrito, apertura, rechazo, adopción y cartera)', () => {
    expect((c.match(/pg_advisory_xact_lock\(hashtext\('cc_dueno:' \|\| /g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
  it('13 · UNA autoridad de ruteo y atribución: la cartera; la atribución de marketing no rutea', () => {
    expect(c).toMatch(/s := public\._cc_vendedor_de\(c\.profile_id\);/)
    expect(c).toMatch(/create or replace function public\._cc_chk_seller\(p_profile uuid\)[\s\S]*?v_id := public\._cc_vendedor_de\(p_profile\);[\s\S]*?'seller_origen', 'cartera'/)
    expect(c).not.toMatch(/seller_preferido_id is not null and public\._cc_puede_atender\(c\.seller_preferido_id\)/)   // el referido ya no asigna
    expect(c).toMatch(/update public\.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now\(\) where id = p_conv;/)   // nunca al azar
  })
  it('25 · sin horario configurado: disponibilidad desconocida, nunca "te conectaremos"', () => {
    expect(c).toMatch(/when not p_configurado then 'Registramos tu solicitud/)
    expect(c).toMatch(/return jsonb_build_object\('configurado', false, 'abierto', false/)
  })
  it('9 · la IA calla solo con human_active; tras human_ended el dueño la reanuda escribiendo; cerrar no es permanente', () => {
    expect(c).toMatch(/\('ai_active', 'human_offered', 'human_requested', 'human_assigned'\)/)
    expect(c).toMatch(/if p_actor_type in \('visitor', 'doctor'\) and c\.modo = 'human_ended' then/)
    expect(c).toMatch(/perform public\._cc_evento\(v, 'conversation_reopened', 'system', null, null, jsonb_build_object\('motivo', 'canal_permanente'\)\);/)
  })
  it('23 · solo Dirección administra horario y cartera; comandos internos fuera del alcance de clientes; tablas sin acceso directo', () => {
    expect(c).toMatch(/if not \(public\._cc_es_admin\(\) or public\._cc_es_service\(\)\) then raise exception 'NO_AUTORIZADO: solo Dirección'/)
    expect(c).toMatch(/revoke all on public\.cc_horario_config, public\.cc_horario_semanal, public\.cc_horario_excepciones, public\.cc_horario_eventos,\n\s+public\.cc_cartera, public\.cc_cartera_historial from public, anon, authenticated;/)
    expect(c).toMatch(/if ant\.profile_id is not null and v_motivo is null then raise exception 'MOTIVO_REQUERIDO/)
    expect(c).toMatch(/trg_cch_append_only/); expect(c).toMatch(/trg_chev_append_only/)
  })
  it('rollback restaura firmas CC-6, la regla de IA, la cola y retira tablas/columnas', () => {
    const d = codigo(down)
    expect(d).toMatch(/drop function if exists public\.cc_checkout_confirmar\(uuid, text, integer, boolean\);/)
    expect(d).toMatch(/CREATE OR REPLACE FUNCTION public\.cc_checkout_confirmar\(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer\)/)
    expect(d).toMatch(/drop table if exists public\.cc_cartera_historial, public\.cc_cartera, public\.cc_horario_eventos/)
    expect(d).toMatch(/not valid;/)
  })
})

describe('Edges e IA', () => {
  it('chat: rechazar = comando del servidor con la identidad derivada (sin parámetros de autoridad); IA hasta human_assigned', () => {
    expect(codigo(chatSrc)).toMatch(/if \(action === 'rechazar_asesor'\) \{[\s\S]*?admin\.rpc\('cc_handoff_rechazar', base\)/)
    expect(codigo(chatShared)).toMatch(/modo === 'human_requested' \|\| modo === 'human_assigned'/)
  })
  it('cart: sin "oferta"; checkout recibe snapshot de dirección acotado e intención de factura, nunca vendedor ni precio', () => {
    const s = codigo(cartSrc)
    expect(s).not.toMatch(/'oferta'|cc_carrito_oferta/)
    expect(s).not.toMatch(/p\.seller|p\.price|p\.precio|p\.total|p\.doctor/)
    expect(s).toMatch(/p_direccion: dir/)
  })
  it('IA: estado del handoff desde el servidor; promesa de humano inmediato bloqueada salvo EN_HORARIO + ASESOR_ASIGNADO', () => {
    expect(codigo(orqSrc)).toMatch(/rpc\('cc_ia_estado_handoff'/); expect(codigo(orqSrc)).not.toMatch(/SELLER_OFFER|'ofrecer'/)
    expect(codigo(valSrc)).toMatch(/if \(!\(ctx\.evidencia\.includes\('EN_HORARIO'\) && ctx\.evidencia\.includes\('ASESOR_ASIGNADO'\)\) && RE_PROMESA_HUMANO\.test\(t\)\)/)
  })
})

describe('frontend', () => {
  it('ningún disparador de handoff en el cliente (solo la mutación del servidor)', () => {
    for (const src of [hookSrc, catalogoSrc, lanzadorSrc]) expect(codigo(src)).not.toMatch(/cc_handoff|_cc_handoff|solicitarAsesor\(/)
  })
  it('25/26 · el Catálogo usa el carrito canónico con backend (el local solo en demo); el Asistente legado ya no existe (UX-1)', () => {
    expect(codigo(catalogoSrc)).toMatch(/const canon = useCarritoCanonico\(hasSupabase\)/)
    expect(codigo(hookSrc)).toMatch(/cola\.current = cola\.current\.then\(/)   // serializado
  })
  it('administración: solo RPC (la base valida Dirección); Bandeja cuenta desde el servidor', () => {
    expect(codigo(atencionSrc)).not.toMatch(/\.from\(/)
    expect(codigo(bandejaSrc)).toMatch(/atencion\.resumen\(\)/)
    expect(codigo(bandejaSrc)).toMatch(/const n = r \? r\.handoffs_sin_asignar \+ r\.reasignacion \+ r\.handoffs_pendientes : 0/)
  })
})
