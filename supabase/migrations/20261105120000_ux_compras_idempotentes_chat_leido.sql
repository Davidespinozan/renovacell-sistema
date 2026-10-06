-- ============================================================================
-- UX-2 / UX-1 · (122) Compras a proveedores idempotentes + cursor de lectura del chat
--
-- P2-1 · La orden de compra/producción nacía con un INSERT directo del navegador con un id
--        aleatorio: un doble clic o un reintento tras timeout creaba DOS órdenes. Ahora nace
--        SOLO por el comando `crear_orden_compra` con op_id estable (registro W1
--        `inventory_operations`, kind 'alta_compra'): el reintento devuelve la misma orden.
--        Misma autoridad que la política RLS vigente (Dirección y Facturación), mismo estado
--        inicial forzado (pendiente / 0 recibido), CERO movimiento de inventario.
-- UX-1 · `cc_leer_conversacion` devuelve además `leido_hasta` (last_read_seq del actor en
--        cc_participants). El lanzador flotante del portal del doctor cuenta "sin leer" con la
--        autoridad del servidor en vez de inventar un cursor local. Sin cambios de permisos.
-- Sin datos migrados. Rollback: supabase/rollback/ux_compras_chat/99_down.sql
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public._w1_op_begin(uuid,text,jsonb)') is null then raise exception 'UX-2: falta W1 (_w1_op_begin)'; end if;
  if to_regprocedure('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)') is null then raise exception 'UX-1: falta CC-7 (cc_leer_conversacion)'; end if;
end $pre$;

-- ── 1) Registro de operaciones: nuevo tipo 'alta_compra' ────────────────────
do $k$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recepcion%carga_inicial%';
  if v_name is not null then execute format('alter table public.inventory_operations drop constraint %I', v_name); end if;
  alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia',
                 'alta_compra'));
end $k$;

-- ── 2) Comando: alta idempotente de compra a proveedor / producción interna ──
create or replace function public.crear_orden_compra(p_op_id uuid, p_product uuid, p_qty integer, p_unit_cost numeric,
                                                      p_kind text default 'compra', p_supplier text default null, p_product_name text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_role text := public.auth_role(); v_req jsonb; v_prev jsonb; v_name text; v_id uuid; v_sup text; v_res jsonb;
begin
  if v_role not in ('admin', 'billing') then raise exception 'NO_AUTORIZADO: las compras a proveedores las registra Dirección o Facturación'; end if;
  if p_kind not in ('compra', 'produccion') then raise exception 'TIPO_INVALIDO: compra o produccion'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero'; end if;
  if p_unit_cost is null or p_unit_cost <= 0 then raise exception 'COSTO_INVALIDO: indica el costo unitario'; end if;
  v_sup := nullif(btrim(coalesce(p_supplier, '')), '');
  if p_kind = 'compra' and v_sup is null then raise exception 'PROVEEDOR_REQUERIDO: indica el proveedor'; end if;
  if p_kind <> 'compra' then v_sup := null; end if;
  select name into v_name from public.products where id = p_product;
  if not found then raise exception 'PRODUCTO_INEXISTENTE'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_product_name, '')), ''), v_name);

  v_req := jsonb_build_object('product', p_product, 'qty', p_qty, 'unit_cost', p_unit_cost, 'kind', p_kind, 'supplier', v_sup);
  v_prev := public._w1_op_begin(p_op_id, 'alta_compra', v_req);
  if v_prev is not null then return v_prev; end if;   -- reintento: la MISMA orden, sin duplicar

  -- El estado inicial lo fuerza replenishments_guard (pendiente / 0). Aquí NO se mueve inventario.
  insert into public.replenishments (product_id, product_name, qty, unit_cost, kind, supplier, status, paid, received_qty, created_by)
  values (p_product, v_name, p_qty, p_unit_cost, p_kind, v_sup, 'pendiente', p_kind <> 'compra', 0, auth.uid())
  returning id into v_id;

  v_res := jsonb_build_object('status', 'applied', 'replenishment_id', v_id, 'replenishment_status', 'pendiente', 'received_qty', 0, 'pending_qty', p_qty, 'paid', p_kind <> 'compra');
  return public._w1_op_finish(p_op_id, 'alta_compra', v_req, v_res);
end;
$$;
revoke all on function public.crear_orden_compra(uuid, uuid, integer, numeric, text, text, text) from public, anon;
grant execute on function public.crear_orden_compra(uuid, uuid, integer, numeric, text, text, text) to authenticated, service_role;

-- ── 3) Lectura de conversación con cursor de lectura del actor ───────────────
CREATE OR REPLACE FUNCTION public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint DEFAULT 0, p_limite integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; v_rol text; c record; v_msgs jsonb; v_asesor text;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m where m.conversation_id = p_conv and m.seq > coalesce(p_desde_seq, 0) order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  select coalesce(p.full_name, p.meta ->> 'name') into v_asesor from public.profiles p where p.id = c.seller_profile_id;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'rol', v_rol, 'ultimo_seq', c.ultimo_seq,
                            'asesor_nombre', v_asesor, 'asesor_soy_yo', c.seller_profile_id is not null and c.seller_profile_id = p_profile,
                            'mensajes', v_msgs,
                            -- UX-1 · cursor de lectura del actor (autoridad: cc_participants.last_read_seq); el badge del portal no inventa estado
                            'leido_hasta', coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id
                                                       and ((p_profile is not null and p.profile_id = p_profile) or (v_visitor is not null and p.visitor_id = v_visitor))
                                                     order by p.last_read_seq desc nulls last limit 1), 0),
                            -- CC-7 · estado del handoff (sin datos del vendedor más allá del nombre ya expuesto)
                            'handoff', jsonb_build_object('origen', c.handoff_origen, 'cart_id', c.handoff_cart_id, 'fuera_horario', c.handoff_fuera_horario,
                                                          'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                                                          'puede_rechazar', v_rol = 'dueno' and c.modo in ('human_requested', 'human_assigned') and c.handoff_origen is not null));
end;
$function$;

-- ── 4) Verificación ──────────────────────────────────────────────────────────
do $post$
begin
  if has_function_privilege('anon', 'public.crear_orden_compra(uuid,uuid,integer,numeric,text,text,text)', 'EXECUTE') then raise exception 'UX-2: anon no debe ejecutar crear_orden_compra'; end if;
  if pg_get_functiondef('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)'::regprocedure) !~ 'leido_hasta' then raise exception 'UX-1: cc_leer_conversacion sin leido_hasta'; end if;
end $post$;
