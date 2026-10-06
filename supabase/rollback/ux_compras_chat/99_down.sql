-- ============================================================================
-- UX-2 / UX-1 (122) · ROLLBACK. Quita `crear_orden_compra` y devuelve `cc_leer_conversacion`
-- al texto EXACTO de 121 (CC-7). No borra datos: las órdenes creadas por el comando son filas
-- normales de replenishments y se conservan; el registro append-only `inventory_operations`
-- no se toca (si ya hay filas 'alta_compra', la restricción original se vuelve a crear NOT VALID).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
drop function if exists public.crear_orden_compra(uuid, uuid, integer, numeric, text, text, text);

do $k$
declare v_name text; v_hay boolean;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recepcion%carga_inicial%';
  if v_name is not null then execute format('alter table public.inventory_operations drop constraint %I', v_name); end if;
  select exists (select 1 from public.inventory_operations where kind = 'alta_compra') into v_hay;
  if v_hay then
    alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia')) not valid;
  else
    alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia'));
  end if;
end $k$;

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
                            -- CC-7 · estado del handoff (sin datos del vendedor más allá del nombre ya expuesto)
                            'handoff', jsonb_build_object('origen', c.handoff_origen, 'cart_id', c.handoff_cart_id, 'fuera_horario', c.handoff_fuera_horario,
                                                          'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                                                          'puede_rechazar', v_rol = 'dueno' and c.modo in ('human_requested', 'human_assigned') and c.handoff_origen is not null));
end;
$function$;
