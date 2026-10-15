-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C4-FISCAL-3 (migración 147) · PEDIDO + RECEPTOR FISCAL INICIAL EN UNA SOLA TRANSACCIÓN
--   Hallazgo (auditoría SEC-C4-FISCAL): Nuevo Pedido llama a crear_pedido y después a set_order_fiscal_snapshot. Si la
--   segunda llamada falla (red, sesión, rechazo), el pedido queda marcado para facturar y sin receptor.
--   Cambio: UNA función NUEVA, con nombre propio (D-F6: sin sobrecargar crear_pedido):
--     crear_pedido_con_receptor(<los 7 parámetros de crear_pedido>, p_receiver jsonb)   — los 8 obligatorios.
--   · crear_pedido NO se modifica (cuerpo, firma, permisos, dueño): la función nueva la invoca y es la única
--     implementación comercial. set_order_fiscal_snapshot y solicitar_cfdi tampoco cambian (FISCAL-1 no se toca).
--   · Con factura el receptor es obligatorio y se valida con las reglas de la 146 ANTES de crear nada (D-F7);
--     sin factura se ignora y no se guarda (D-F3).
--   · Reintentos: crear_pedido devuelve folio y total de CUALQUIER pedido existente a quien envíe su id. La función
--     nueva no hereda eso: un pedido existente solo se confirma a quien lo creó y si la solicitud es la misma,
--     comparada contra el alta ORIGINAL (bitácora del pedido, escrita por trigger y solo-agregar). Si no: conflicto.
--   · No valida catálogos del SAT ni caracteres invisibles Unicode (pendientes, D-F4). Quién corrige después el
--     receptor es FISCAL-1 (D-F8), no este bloque.
--   Sin cambios de tablas, datos, RLS, triggers ni permisos existentes. Depende de la 146.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/sec_c4_fiscal3/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido_con_receptor') then
    raise exception 'SEC-C4-FISCAL-3: ya aplicada';
  end if;
  -- crear_pedido INTACTA: es la única implementación comercial (identidad, precios, vendedor, snapshots).
  if md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> 'bee5aa3614e2b9e0327ebec6a1b38e2e'
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido') <> 1 then
    raise exception 'SEC-C4-FISCAL-3: crear_pedido no es la versión auditada (o tiene sobrecargas)';
  end if;
  if (select proowner::regrole::text || ':' || prosecdef || ':' || coalesce(proconfig::text, '-') from pg_proc where oid = 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) <> 'postgres:true:{search_path=public}'
     or not has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') or has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') then
    raise exception 'SEC-C4-FISCAL-3: cambió el dueño, la forma o los permisos de crear_pedido';
  end if;
  -- SEC-C4-FISCAL-2 (146) aplicada: la validación del receptor es la misma que la del POS.
  if to_regprocedure('public._fiscal_entrada_error(jsonb)') is null then
    raise exception 'SEC-C4-FISCAL-3: falta SEC-C4-FISCAL-2 (146): aplícala antes';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public._fiscal_entrada_error(jsonb)'))) <> 'b651a11fd4cd94040473a1aa503986c0'
     or md5(pg_get_functiondef('public._fiscal_clean(jsonb)'::regprocedure)) <> '1e8d88c21e6a1fd469ea101126c658f6' then
    raise exception 'SEC-C4-FISCAL-3: las funciones de validación de la 146 no son las auditadas';
  end if;
  -- La seguridad de reintentos descansa en la bitácora del propio pedido (alta y cambios), escrita por trigger.
  if md5(pg_get_functiondef('public.log_audit()'::regprocedure)) <> '7026276516a63fb54f0dd7287a927ecc'
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgfoid = 'public.log_audit()'::regprocedure
                      and t.tgenabled = 'O' and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0)
     or has_table_privilege('authenticated', 'public.audit_logs', 'insert') or has_table_privilege('authenticated', 'public.audit_logs', 'update')
     or has_table_privilege('authenticated', 'public.audit_logs', 'delete') or has_table_privilege('anon', 'public.audit_logs', 'insert')
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 'trg_audit_logs_append_only' and t.tgenabled = 'O') then
    raise exception 'SEC-C4-FISCAL-3: la bitácora de pedidos (trigger de alta/cambio, solo-agregar, sin escritura de clientes) no tiene la forma auditada';
  end if;
end $pre$;

create function public.crear_pedido_con_receptor(
  p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb,
  p_invoice_requested boolean, p_customer_id uuid, p_receiver jsonb
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- SEC-C4-FISCAL-3 · Pedido + receptor fiscal inicial en UNA transacción. La creación comercial (cuenta, comprador,
-- precios, vendedor, capturista, folio, snapshots) la hace crear_pedido, sin cambios; aquí solo se añade:
--   · validación del receptor ANTES de crear nada (reglas de la 146);
--   · el receptor inicial, guardado en la misma transacción;
--   · reintentos seguros: un pedido existente solo se confirma a QUIEN LO CREÓ y si la solicitud es la MISMA
--     (cuenta, comprador, renglones, envío, factura y receptor), comparada contra los datos ORIGINALES del alta
--     (bitácora del pedido, solo-agregar). En cualquier otro caso: conflicto, sin datos y sin escribir.
declare
  v_uid uuid := auth.uid();
  v_rol text := public.auth_role();
  v_fact boolean := coalesce(p_invoice_requested, false);
  v_clean jsonb; v_err text; v_res jsonb;
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_ord record; v_alta record; v_envio jsonb; v_recv jsonb; v_n int;
  k_srv constant text[] := array['customer', 'seller', 'seller_profile_id', 'seller_origen', 'placed_by'];
  c_conflicto constant text := 'PEDIDO_EXISTENTE_CONFLICTO: ese identificador ya corresponde a otra solicitud de pedido';
begin
  -- 1) Quién puede crear: EXACTAMENTE la regla de crear_pedido (no se amplía; crear_pedido la vuelve a aplicar).
  if not ((v_rol = 'doctor' and p_doctor_id = v_uid and public.is_verified()) or v_rol = any (array['admin', 'pos'])) then
    raise exception 'No autorizado';
  end if;
  if p_order_id is null then raise exception 'PEDIDO_ID_REQUERIDO: el pedido requiere un identificador estable'; end if;

  -- 2) Receptor: obligatorio y válido si se pide factura; ignorado si no (D-F3 / D-F7). Nada se ha escrito aún.
  if v_fact then
    if p_receiver is null or jsonb_typeof(p_receiver) = 'null' then
      raise exception 'DATOS_FISCALES_REQUERIDOS: el pedido solicita factura pero no trae los datos fiscales del receptor';
    end if;
    if length(p_receiver::text) > 4000 then raise exception 'FISCAL_INVALIDO: los datos de factura exceden el tamaño permitido'; end if;
    v_err := public._fiscal_entrada_error(p_receiver);
    if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
    v_clean := public._fiscal_clean(p_receiver);
  end if;

  -- 3) Una sola solicitud a la vez por identificador de pedido (la segunda espera y ve lo confirmado por la primera).
  perform pg_advisory_xact_lock(hashtextextended('f3-pedido:' || p_order_id::text, 0));

  -- 4) ¿Ya existe? Solo se confirma a su creador y con la misma solicitud. Nunca se devuelven datos de otro.
  select o.id, o.created_at into v_ord from public.orders o where o.id = p_order_id;
  if found then
    -- Alta ORIGINAL del pedido: la fila que el trigger de bitácora escribió en la misma transacción que lo creó.
    select a.actor, a.payload into v_alta
      from public.audit_logs a
     where a.resource_type = 'orders' and a.resource_id = p_order_id::text and a.action = 'INSERT orders'
       and a.created_at = v_ord.created_at;
    if not found or v_alta.actor is null or v_alta.actor is distinct from v_uid then raise exception '%', c_conflicto; end if;
    -- Receptor ORIGINAL: el que el creador dejó en esa MISMA transacción (si lo hubo). Más de uno distinto ⇒ no se
    -- puede demostrar cuál fue el inicial ⇒ conflicto.
    select count(*), (array_agg(x.r))[1] into v_n, v_recv
      from (select distinct a.payload -> 'invoice_meta' -> 'receiver' as r
              from public.audit_logs a
             where a.resource_type = 'orders' and a.resource_id = p_order_id::text and a.action = 'UPDATE orders'
               and a.created_at = v_ord.created_at and a.actor = v_uid
               and jsonb_typeof(a.payload -> 'invoice_meta' -> 'receiver') = 'object') x;
    if v_n > 1 then raise exception '%', c_conflicto; end if;
    v_envio := case when p_shipping_meta is null or jsonb_typeof(p_shipping_meta) = 'null' then '{}'::jsonb
                    when jsonb_typeof(p_shipping_meta) = 'object' then p_shipping_meta - k_srv end;
    if v_envio is null
       or nullif(v_alta.payload ->> 'doctor_id', '')::uuid is distinct from p_doctor_id
       or (v_rol <> 'doctor' and nullif(v_alta.payload ->> 'customer_id', '')::uuid is distinct from p_customer_id)
       or (v_rol = 'doctor' and p_customer_id is not null and nullif(v_alta.payload ->> 'customer_id', '')::uuid is distinct from p_customer_id)
       or (coalesce(v_alta.payload -> 'shipping_meta', '{}'::jsonb) - k_srv) is distinct from v_envio
       or (v_fact and v_recv is distinct from v_clean)
       or (not v_fact and (coalesce((v_alta.payload ->> 'invoice_requested')::boolean, false) or v_recv is not null))
       or p_lines is null or jsonb_typeof(p_lines) <> 'array'
       or (select coalesce(array_agg(x.k order by x.k), '{}') from (select ((l ->> 'product_id')::uuid)::text || ':' || ((l ->> 'qty')::numeric)::text as k from jsonb_array_elements(p_lines) l) x)
          is distinct from
          (select coalesce(array_agg(y.k order by y.k), '{}') from (select i.product_id::text || ':' || (i.qty::numeric)::text as k from public.order_items i where i.order_id = p_order_id) y) then
      raise exception '%', c_conflicto;
    end if;
    return jsonb_build_object('order_id', p_order_id, 'total', (v_alta.payload ->> 'total')::numeric,
                              'folio', v_alta.payload ->> 'external_ref', 'idempotent', true);
  end if;

  -- 5) Creación comercial: crear_pedido, tal cual.
  v_res := public.crear_pedido(p_order_id, p_folio, p_doctor_id, p_lines, p_shipping_meta, v_fact, p_customer_id);
  if coalesce((v_res ->> 'idempotent')::boolean, false) or (v_res ->> 'order_id')::uuid is distinct from p_order_id then
    raise exception '%', c_conflicto;   -- otro flujo creó ese identificador mientras tanto: no se toca ni se revela
  end if;

  -- 6) Receptor inicial, en la misma transacción. No toca el perfil fiscal permanente del cliente.
  if v_clean is not null then
    perform set_config('app.trusted', 'on', true);
    update public.orders set invoice_meta = jsonb_build_object('receiver', v_clean), invoice_requested = true where id = p_order_id;
    perform set_config('app.trusted', v_trusted, true);
    perform public._fiscal_audit('Snapshot fiscal congelado', 'order:' || p_order_id, v_clean);
  end if;
  return v_res;
end;
$$;

alter function public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb) owner to postgres;
comment on function public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb) is 'SEC-C4-FISCAL-3 · Crea el pedido (vía crear_pedido, sin cambios) y guarda su receptor fiscal inicial en la misma transacción. Reintento: solo se confirma al creador y con la misma solicitud.';
revoke all on function public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb) to authenticated, service_role;   -- mismos permisos que crear_pedido (service_role no pasa la regla interna)

do $post$ begin
  if md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) <> '5769c551e6ca60003ba0fcf9390d80d1' then
    raise exception 'SEC-C4-FISCAL-3: la función no quedó con la definición esperada';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido_con_receptor') <> 1
     or (select proowner::regrole::text || ':' || prosecdef || ':' || coalesce(proconfig::text, '-') || ':' || provolatile::text || ':' || prorettype::regtype::text || ':' || pronargdefaults
           from pg_proc where oid = 'public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure) <> 'postgres:true:{search_path=public}:v:jsonb:0' then
    raise exception 'SEC-C4-FISCAL-3: cambió el dueño, SECURITY DEFINER, el search_path, el retorno o hay valores por defecto';
  end if;
  if (select array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type
                         order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end)
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)
       is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE'] then
    raise exception 'SEC-C4-FISCAL-3: los permisos de la función no son los esperados';
  end if;
  -- crear_pedido INTACTA: es la única implementación comercial (identidad, precios, vendedor, snapshots).
  if md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> 'bee5aa3614e2b9e0327ebec6a1b38e2e'
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido') <> 1 then
    raise exception 'SEC-C4-FISCAL-3: crear_pedido no es la versión auditada (o tiene sobrecargas)';
  end if;
  if (select proowner::regrole::text || ':' || prosecdef || ':' || coalesce(proconfig::text, '-') from pg_proc where oid = 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) <> 'postgres:true:{search_path=public}'
     or not has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') or has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') then
    raise exception 'SEC-C4-FISCAL-3: cambió el dueño, la forma o los permisos de crear_pedido';
  end if;
  -- SEC-C4-FISCAL-2 (146) aplicada: la validación del receptor es la misma que la del POS.
  if to_regprocedure('public._fiscal_entrada_error(jsonb)') is null then
    raise exception 'SEC-C4-FISCAL-3: falta SEC-C4-FISCAL-2 (146): aplícala antes';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public._fiscal_entrada_error(jsonb)'))) <> 'b651a11fd4cd94040473a1aa503986c0'
     or md5(pg_get_functiondef('public._fiscal_clean(jsonb)'::regprocedure)) <> '1e8d88c21e6a1fd469ea101126c658f6' then
    raise exception 'SEC-C4-FISCAL-3: las funciones de validación de la 146 no son las auditadas';
  end if;
  -- La seguridad de reintentos descansa en la bitácora del propio pedido (alta y cambios), escrita por trigger.
  if md5(pg_get_functiondef('public.log_audit()'::regprocedure)) <> '7026276516a63fb54f0dd7287a927ecc'
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgfoid = 'public.log_audit()'::regprocedure
                      and t.tgenabled = 'O' and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0)
     or has_table_privilege('authenticated', 'public.audit_logs', 'insert') or has_table_privilege('authenticated', 'public.audit_logs', 'update')
     or has_table_privilege('authenticated', 'public.audit_logs', 'delete') or has_table_privilege('anon', 'public.audit_logs', 'insert')
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 'trg_audit_logs_append_only' and t.tgenabled = 'O') then
    raise exception 'SEC-C4-FISCAL-3: la bitácora de pedidos (trigger de alta/cambio, solo-agregar, sin escritura de clientes) no tiene la forma auditada';
  end if;
end $post$;
