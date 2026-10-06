// CC-5 · Guardas de repositorio: la migración sostiene el carrito como intención (sin autoridad
// económica persistida), un activo por dueño, idempotencia por operación, autoridad por posesión/
// perfil, fusión atómica en la adopción, oferta decidida por el servidor; la Edge `cart` deriva
// identidad y nunca acepta precio/lista/dueño; la IA usa los mismos comandos con operation_id
// estable; el frontend integra el panel sin tocar el legacy; rollback devuelve adopción a CC-2.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261031120000_cc5_carrito.sql?raw'
import down from '../../../../../supabase/rollback/cc5/99_down.sql?raw'
import cartSrc from '../../../../../supabase/functions/cart/index.ts?raw'
import carritoShared from '../../../../../supabase/functions/_shared/carrito.ts?raw'
import orqSrc from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'
import herSrc from '../../../../../supabase/functions/_shared/ia/herramientas.ts?raw'
import valSrc from '../../../../../supabase/functions/_shared/ia/validacion.ts?raw'
import polSrc from '../../../../../supabase/functions/_shared/ia/politica.ts?raw'
import limiteSrc from '../../../../../supabase/functions/_shared/limite.ts?raw'
import opsSrc from './carrito.ts?raw'
import panelSrc from '../../screens/chat/CarritoPanel.tsx?raw'
import chatPantalla from '../../screens/chat/ChatCanonico.tsx?raw'
import catalogoLegacy from '../../screens/doctor/Catalogo.tsx?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-5', () => {
  const c = codigo(mig)
  it('CART17/18 · el item solo guarda product_id + quantity; sin precio/stock/costo; cantidades 1..999', () => {
    const item = c.slice(c.indexOf('create table public.cc_cart_items'), c.indexOf('create table public.cc_cart_operations'))
    expect(item).not.toMatch(/price|precio|subtotal|discount|descuento|stock|cost|tax|margin/i)
    expect(item).toMatch(/constraint ck_ccitem_qty check \(quantity between 1 and 999\)/)
    expect(item).toMatch(/primary key \(cart_id, product_id\)/)
  })
  it('G · un activo por visitante no adoptado y uno por perfil; CART2 · autoridad por posesión/perfil, asesor asignado por CC-2 solo lectura', () => {
    expect(c).toMatch(/create unique index uq_ccart_visitor_activo on public\.cc_carts \(visitor_id\) where estado = 'active' and visitor_id is not null and profile_id is null/)
    expect(c).toMatch(/create unique index uq_ccart_profile_activo on public\.cc_carts \(profile_id\) where estado = 'active' and profile_id is not null/)
    expect(c).toMatch(/if p_visitor is not null and c\.visitor_id = p_visitor and c\.profile_id is null then return 'dueno'; end if;/)
    expect(c).toMatch(/cv\.seller_profile_id = p_profile and cv\.estado = 'abierta' and cv\.modo in \('human_assigned', 'human_active'\)/)
    expect(c).toMatch(/if v_rol <> 'dueno' then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito'/)
  })
  it('L · idempotencia por (cart, operation_id) con hash del payload; conflicto si difiere', () => {
    expect(c).toMatch(/primary key \(cart_id, operation_id\)/)
    expect(c).toMatch(/if e\.payload_hash <> h then raise exception 'IDEMPOTENCIA_CONFLICTO'/)
  })
  it('N/O · la proyección usa cc_ia_precio / cc_ia_disponibilidad (misma autoridad CC-4) y nunca escribe precio', () => {
    const proy = c.slice(c.indexOf('create or replace function public.cc_carrito_proyeccion'), c.indexOf('create or replace function public.cc_carrito_abrir'))
    expect(proy).toMatch(/pr := public\.cc_ia_precio\(p_lector, it\.product_id, it\.quantity\)/)
    expect(proy).toMatch(/disp := public\.cc_ia_disponibilidad\(p_lector, it\.product_id\)/)
    expect(proy).not.toMatch(/update |insert /)
    expect(c).not.toMatch(/precio_de\(|product_costs|product_fiscal|lots\b/)
  })
  it('H · adopción atómica con fusión (suma acotada) dentro de cc_visitante_adoptar, después de las conversaciones; purga respeta carritos', () => {
    expect(c).toMatch(/convs := public\._cc_adoptar_conversaciones\(v\.id, p_profile\);\s+-- CC-2\n\s+carts := public\._cc_adoptar_carritos\(v\.id, p_profile\);/)
    expect(c).toMatch(/least\(coalesce\(antes, 0\) \+ it\.quantity, 999\)/)
    expect(c).toMatch(/set profile_id = p_profile, estado = 'merged', merged_into_cart_id = pc/)
    expect(c).toMatch(/and not exists \(select 1 from public\.cc_carts k where k\.visitor_id = v\.id\)/)
  })
  it('X/Y · elegibilidad de oferta = servidor (vacío→no vacío, sin oferta previa o cooldown vencido); una por carrito; cooldown 7 días', () => {
    expect(c).toMatch(/'oferta_elegible', primera and \(c\.oferta_estado is null or \(c\.oferta_estado = 'rechazada' and c\.oferta_siguiente_at <= now\(\)\)\)/)
    expect(c).toMatch(/oferta_siguiente_at = now\(\) \+ interval '7 days'/)
  })
  it('AB/AC · preparar checkout solo lee/valida y expone el contrato [{product_id, qty}] para crear_pedido; nunca llama crear_pedido', () => {
    const prep = c.slice(c.indexOf('create or replace function public.cc_carrito_preparar_checkout'), c.indexOf('-- 5) ADOPCIÓN'))
    expect(prep).toMatch(/'lineas_crear_pedido'/); expect(prep).not.toMatch(/insert into public\.orders|crear_pedido\(|update public\.cc_cart_items/)
    expect(c).not.toMatch(/crear_pedido\(|vender_pos|stripe|cobrar|kardex|lots\.quantity/)
  })
  it('AL · RLS en 4 tablas; comandos solo service_role; eventos append-only; Dirección lee eventos', () => {
    for (const t of ['cc_carts', 'cc_cart_items', 'cc_cart_operations', 'cc_cart_events']) expect(c).toContain(`alter table public.${t} enable row level security`)
    expect(c).toMatch(/revoke all on public\.cc_carts, public\.cc_cart_items, public\.cc_cart_operations, public\.cc_cart_events from public, anon, authenticated/)
    expect(c).toMatch(/grant execute on function public\.cc_carrito_abrir[\s\S]*to service_role;/)
    expect(c).not.toMatch(/grant execute on function public\.cc_carrito_[^\n]*to (anon|authenticated)/)
    expect(c).toMatch(/create trigger trg_ccev_append_only before update or delete on public\.cc_cart_events/)
  })
  it('rollback: retira tablas/funciones y devuelve adopción y purga al texto CC-2', () => {
    const d = codigo(down)
    expect(d).toContain('drop table if exists public.cc_carts'); expect(d).toMatch(/convs := public\._cc_adoptar_conversaciones\(v\.id, p_profile\);/); expect(d).not.toMatch(/_cc_adoptar_carritos\(v\.id/)
  })
})

describe('Edge cart + módulo compartido', () => {
  const s = codigo(cartSrc)
  it('identidad derivada (JWT o token); el cliente no manda dueño, precio, lista ni seller; operation_id obligatorio en mutaciones; CC-7 · sin acción "oferta" (el handoff lo dispara el servidor)', () => {
    expect(s).toMatch(/const actor = derivarActor\(quien, hash\)/)
    expect(s).not.toMatch(/p\.profile_id|p\.visitor_id|p\.seller|p\.price|p\.precio|p\.discount|p\.price_list/)
    expect(s).toMatch(/const op = validarOperacion\(p\.operation_id\)\n\s+if \(!op\) return json\(400/)
    expect(s).not.toMatch(/action === 'oferta'|cc_carrito_oferta/)
    expect(s).toMatch(/const CAMPOS_DIRECCION = \['line1', 'colonia', 'cp', 'city', 'state', 'refs', 'phone', 'country', 'contacto'\] as const/)   // CC-7 · snapshot acotado
    expect(s).toMatch(/Deno\.serve\(conCors\(/); expect(s).not.toMatch(/console\.(log|error|warn)|_shared\/observa/)
    for (const sc of ['cart_leer', 'cart_mutar', 'cart_mutar_uid', 'cart_global']) { expect(s).toContain(`'${sc}'`); expect(codigo(limiteSrc)).toContain(`${sc}:`) }
    expect(codigo(carritoShared)).not.toMatch(/^import /m)
  })
})

describe('extensión CC-4 (IA)', () => {
  it('Q/T · herramientas de carrito cerradas; evidencias CART_READ/CART_MUTATION (+ CC-7 handoff del servidor); grounding de "ya agregué" y "tu carrito tiene"', () => {
    const h = codigo(herSrc)
    for (const n of ['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'declinar_asesor']) expect(h).toContain(`name: '${n}'`)
    expect(h).toMatch(/'CART_READ_EVIDENCE' \| 'CART_MUTATION_EVIDENCE' \| 'CHECKOUT_REVIEW_EVIDENCE'/); expect(h).not.toMatch(/SELLER_OFFER/)
    expect(h).toMatch(/'HANDOFF_SOLICITADO' \| 'HANDOFF_EN_CURSO' \| 'ASESOR_ASIGNADO' \| 'ASESOR_SIN_ASIGNAR' \| 'EN_HORARIO' \| 'FUERA_DE_HORARIO' \| 'HORARIO_DESCONOCIDO' \| 'HANDOFF_RECHAZADO'/)
    const v = codigo(valSrc)
    expect(v).toMatch(/if \(!ctx\.evidencia\.includes\('CART_MUTATION_EVIDENCE'\) && RE_CART_MUT\.test\(t\)\) return \{ ok: false, motivo: 'carrito_mutacion_sin_evidencia' \}/)
    expect(v).toMatch(/carrito_lectura_sin_evidencia/)
  })
  it('R/S · política: solo mutar ante petición explícita; "me interesa" no es orden; CC-7 · la atención humana la decide el servidor (horario/ruteo) y el LLM no promete más de lo que hay', () => {
    const p = codigo(polSrc)
    expect(p).toMatch(/SOLO ante una petición explícita e inequívoca/); expect(p).toMatch(/"Me interesa" o "quizá" NO es una orden/)
    expect(p).toMatch(/ATENCIÓN HUMANA \(decidida por el servidor\)/); expect(p).not.toMatch(/OFERTA DE ASESOR/)
    expect(p).toMatch(/El equipo de asesores NO está disponible ahora: no digas que un asesor viene/)
  })
  it('CART23/43 · la IA usa los MISMOS comandos (cc_carrito_*) con actor ai en nombre del dueño y operation_id estable turno+ronda+herramienta+args; CC-7 · sin oferta; declinar = rechazo canónico del handoff', () => {
    const o = codigo(orqSrc)
    expect(o).toMatch(/const op = `\$\{t\.turnId\}:r\$\{t\.ronda\}:\$\{v\.nombre\}:\$\{huella\(JSON\.stringify\(a\)\)\}`/)
    expect(o).toMatch(/case 'agregar_al_carrito': return rpc\('cc_carrito_agregar', \{ p_cart: cart, p_actor_type: 'ai'/)
    expect(o).not.toMatch(/SELLER_OFFER|cc_carrito_oferta|p_accion/)
    expect(o).toMatch(/case 'solicitar_asesor': return rpc\('cc_solicitar_asesor'/); expect(o).toMatch(/case 'declinar_asesor': return rpc\('cc_handoff_rechazar', \{ p_conv: e\.conv, p_actor_type: 'ai'/)
    expect(o).toMatch(/const hs = await rpc\('cc_ia_estado_handoff', \{ p_conv: e\.conv \}\)/)
    expect(o).not.toMatch(/^import /m)
  })
})

describe('frontend', () => {
  it('AE · panel compacto dentro de ChatCanonico (dueño muta, asesor solo lectura); cliente sin autoridad; sin checkout', () => {
    expect(codigo(chatPantalla)).toMatch(/<CarritoPanel conversationId=\{asesor \? null : convId\} cartId=\{asesor \? conv\.cart_id \?\? null : null\} soloLectura=\{asesor\}/)
    const p = codigo(panelSrc)
    expect(p).toMatch(/const puedeMutar = !soloLectura && cart\.rol !== 'asesor' && cart\.rol !== 'supervisor' && cart\.estado === 'active'/)
    expect(p).not.toMatch(/crear_pedido|createOrder|supabase\./)   // (CC-6 añadió el pago con Stripe tras crear el pedido; el panel sigue sin crear pedidos)
    expect(p).toMatch(/Precio al verificar tu cuenta/)
    expect(codigo(opsSrc)).not.toMatch(/\.from\(|price_list|discount|seller/)
  })
  it('AF · CC-7 · el Catálogo del doctor converge al carrito CANÓNICO (una sola verdad comercial); el carrito local queda solo para modo demo', () => {
    expect(catalogoLegacy).toMatch(/const canon = useCarritoCanonico\(hasSupabase\)/)
    expect(catalogoLegacy).toMatch(/const cart: Cart = hasSupabase \? canon\.qty : cartLocal/)
    expect(catalogoLegacy).toMatch(/hasSupabase\s*\? confirmarCanonico\(invoice, choice, perfilFiscalId\)/)
    expect(catalogoLegacy).not.toMatch(/cc_carrito_|supabase\.rpc/)   // todo por el cliente de la Edge cart
  })
})
