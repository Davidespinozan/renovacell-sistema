-- SEC-C4-FISCAL-3 (147) · down: elimina ÚNICAMENTE crear_pedido_con_receptor. No toca crear_pedido, la 146, tablas,
-- datos, políticas ni permisos de otras funciones. Los pedidos creados con la función conservan su receptor.
-- ⚠️ Un frontend que ya use la función nueva dejaría de poder crear pedidos con factura: revertir primero el frontend.
do $pre$ begin
  if to_regprocedure('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)') is null then raise exception 'SEC-C4-FISCAL-3 down: la función no existe; nada que revertir'; end if;
  if md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) <> '5769c551e6ca60003ba0fcf9390d80d1' then
    raise exception 'SEC-C4-FISCAL-3 down: la función no está en el estado de la 147; no se revierte sobre un estado desconocido';
  end if;
end $pre$;

drop function public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb);

do $post$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido_con_receptor') then
    raise exception 'SEC-C4-FISCAL-3 down: la función sigue existiendo';
  end if;
  -- crear_pedido INTACTA: es la única implementación comercial (identidad, precios, vendedor, snapshots).
  if md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> 'bee5aa3614e2b9e0327ebec6a1b38e2e'
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido') <> 1 then
    raise exception 'SEC-C4-FISCAL-3 down: crear_pedido no es la versión auditada (o tiene sobrecargas)';
  end if;
  if (select proowner::regrole::text || ':' || prosecdef || ':' || coalesce(proconfig::text, '-') from pg_proc where oid = 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) <> 'postgres:true:{search_path=public}'
     or not has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') or has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') then
    raise exception 'SEC-C4-FISCAL-3 down: cambió el dueño, la forma o los permisos de crear_pedido';
  end if;
  -- SEC-C4-FISCAL-2 (146) aplicada: la validación del receptor es la misma que la del POS.
  if to_regprocedure('public._fiscal_entrada_error(jsonb)') is null then
    raise exception 'SEC-C4-FISCAL-3 down: falta SEC-C4-FISCAL-2 (146): aplícala antes';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public._fiscal_entrada_error(jsonb)'))) <> 'b651a11fd4cd94040473a1aa503986c0'
     or md5(pg_get_functiondef('public._fiscal_clean(jsonb)'::regprocedure)) <> '1e8d88c21e6a1fd469ea101126c658f6' then
    raise exception 'SEC-C4-FISCAL-3 down: las funciones de validación de la 146 no son las auditadas';
  end if;
  -- La seguridad de reintentos descansa en la bitácora del propio pedido (alta y cambios), escrita por trigger.
  if md5(pg_get_functiondef('public.log_audit()'::regprocedure)) <> '7026276516a63fb54f0dd7287a927ecc'
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgfoid = 'public.log_audit()'::regprocedure
                      and t.tgenabled = 'O' and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0)
     or has_table_privilege('authenticated', 'public.audit_logs', 'insert') or has_table_privilege('authenticated', 'public.audit_logs', 'update')
     or has_table_privilege('authenticated', 'public.audit_logs', 'delete') or has_table_privilege('anon', 'public.audit_logs', 'insert')
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 'trg_audit_logs_append_only' and t.tgenabled = 'O') then
    raise exception 'SEC-C4-FISCAL-3 down: la bitácora de pedidos (trigger de alta/cambio, solo-agregar, sin escritura de clientes) no tiene la forma auditada';
  end if;
end $post$;
