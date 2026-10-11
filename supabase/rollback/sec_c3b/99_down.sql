-- SEC-C3b (144) · down: restaura shipments_guard y confirmar_entrega EXACTAMENTE como en producción antes de la 144 y
-- elimina el índice único de evidencia, el disparador de storage.objects y su función. No toca datos ni la 143.
-- ⚠️ REABRE LOS HALLAZGOS: el chofer vuelve a reabrir entregas, a recuperar el contacto del doctor, a leer fotos ajenas
-- por referencia y a borrar o sustituir evidencia; y el cierre vuelve a aceptar cualquier texto como evidencia.
-- Con la 143 aplicada y la 144 revertida, los controles de chofer de la 143 quedan eludibles. No revertir sin decisión.
do $pre$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- SEC-C3 (143) aplicada y en su versión esperada: la 144 solo tiene sentido encima de ella.
  if to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is null
     or md5(pg_get_functiondef('public._sec_c3_alcance_doctor(uuid)'::regprocedure)) <> 'a02824e5ebbc6d46a57504c1c9824431'
     or (select string_agg(policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname)
           from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%')
        is distinct from 'proofs_insert=d44f6a17bd492a78d2ab9f5c6e5304aa,proofs_owner_delete=6f712015ffc47aa269fddd6b45f7a1a8,proofs_owner_write=6f712015ffc47aa269fddd6b45f7a1a8,proofs_read=63f31185a559c5b0277167ea346ba4c0' then
    raise exception 'SEC-C3b down: SEC-C3 (143) no está aplicada en su versión esperada';
  end if;
  -- Las dos funciones: una sola firma cada una, la versión esperada, dueño, SECURITY DEFINER, search_path y permisos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega')) <> 2
     or to_regprocedure('public.shipments_guard()') is null or to_regprocedure('public.confirmar_entrega(uuid,text,text)') is null
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> 'b1e791b99ca8043cb1e2913e0b294600'
     or md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) <> '3da25f3db1514408463b5fb38f61d0b6' then
    raise exception 'SEC-C3b down: shipments_guard / confirmar_entrega no están en el estado SEC-C3b esperado; no se revierte sobre un estado desconocido';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('public.shipments_guard()'::regprocedure, 'public.confirmar_entrega(uuid,text,text)'::regprocedure)
              and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                   or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select prorettype::regtype::text from pg_proc where oid = 'public.shipments_guard()'::regprocedure) <> 'trigger'
     or (select prorettype::regtype::text from pg_proc where oid = 'public.confirmar_entrega(uuid,text,text)'::regprocedure) <> 'void'
     or has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') then
    raise exception 'SEC-C3b down: cambió el dueño, SECURITY DEFINER, el search_path, el retorno o los permisos de las funciones';
  end if;
  -- shipments: los mismos dos disparadores (habilitados) y las mismas cuatro políticas. Nada más escribe la tabla por otra vía.
  select string_agg(t.tgname || ':' || t.tgtype || ':' || p.proname || ':' || t.tgenabled::text, ',' order by t.tgname) into v
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.shipments'::regclass and not t.tgisinternal;
  if v is distinct from 'shipments_audit_trigger:21:log_audit:O,shipments_guard_trg:19:shipments_guard:O' then
    raise exception 'SEC-C3b down: los disparadores de shipments no son los auditados (%)', v;
  end if;
  select string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) into v
    from pg_policies where schemaname = 'public' and tablename = 'shipments';
  if v is distinct from 'shipments_delete_admin:DELETE:5bcc703ac8a5985e6af92e14b0c56ef7,shipments_insert_ops:INSERT:241a43c125bd5eeab2f3d423ce0b991d,shipments_select_scoped:SELECT:be20dba7962e591bc813a2c2060b275c,shipments_update_scoped:UPDATE:faab6ff4b240da8f2b5ba52d600f463f'
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3b down: las políticas de shipments no son las auditadas (%)', v;
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.shipments'::regclass and not attisdropped
        and attname in ('status', 'load_confirmed_at', 'incident', 'delivered_at', 'proof_image_url', 'received_by', 'driver_id', 'order_id')) <> 8
     or (select count(*) from pg_attribute where attrelid = 'storage.objects'::regclass and not attisdropped and attname in ('bucket_id', 'name', 'owner', 'owner_id')) <> 4 then
    raise exception 'SEC-C3b down: faltan columnas de shipments o de storage.objects de las que depende el control';
  end if;
  -- Las piezas nuevas: índice único válido, función en su versión y sin permisos de usuario, disparador habilitado.
  if not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.shipments_proof_unica') and i.indrelid = 'public.shipments'::regclass
                  and i.indisunique and i.indisvalid and i.indpred is not null)
     or to_regprocedure('public._sec_c3b_proteger_evidencia()') is null
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3b_proteger_evidencia') <> 1
     or md5(pg_get_functiondef('public._sec_c3b_proteger_evidencia()'::regprocedure)) <> '668040eb39bb13f44578d83716255b92'
     or exists (select 1 from pg_proc p where p.oid = 'public._sec_c3b_proteger_evidencia()'::regprocedure
                 and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']))
     or has_function_privilege('anon', 'public._sec_c3b_proteger_evidencia()', 'execute')
     or has_function_privilege('authenticated', 'public._sec_c3b_proteger_evidencia()', 'execute')
     or (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'storage.objects'::regclass and t.tgname = 'sec_c3b_proteger_evidencia'
           and t.tgtype = 27 and t.tgenabled = 'O' and p.proname = '_sec_c3b_proteger_evidencia' and t.tgqual is not null) <> 1 then
    raise exception 'SEC-C3b down: el índice, la función o el disparador de SEC-C3b no están en el estado SEC-C3b esperado';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

drop trigger sec_c3b_proteger_evidencia on storage.objects;
drop function public._sec_c3b_proteger_evidencia();
drop index public.shipments_proof_unica;

CREATE OR REPLACE FUNCTION public.shipments_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r text := public.auth_role();
BEGIN
  IF r = 'admin' OR r IN ('warehouse','packing') THEN
    RETURN NEW;
  END IF;

  IF r = 'driver' AND OLD.driver_id = auth.uid() THEN
    IF NEW.order_id        IS DISTINCT FROM OLD.order_id
       OR NEW.driver_id    IS DISTINCT FROM OLD.driver_id
       OR NEW.carrier      IS DISTINCT FROM OLD.carrier
       OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number THEN
      RAISE EXCEPTION 'No autorizado: el chofer solo actualiza estado, entrega y prueba';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirmar_entrega(p_shipment_id uuid, p_proof_path text DEFAULT NULL::text, p_received_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_driver   uuid;
  v_estado   text;
begin
  select s.order_id, s.driver_id, s.status
    into v_order_id, v_driver, v_estado
    from shipments s where s.id = p_shipment_id;

  if v_order_id is null then
    raise exception 'El envío no existe';
  end if;

  -- Solo el chofer asignado, o Almacén/Dirección desde el escritorio.
  if not (v_driver = auth.uid() or public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;

  -- La evidencia es obligatoria: sin quién recibió, no hay entrega comprobable.
  if coalesce(btrim(p_received_by), '') = '' then
    raise exception 'Falta el nombre de quien recibió';
  end if;

  if v_estado = 'delivered' then
    return; -- idempotente: reintento del celular sin señal no rompe nada
  end if;

  -- `orders_guard()` no reconoce al rol chofer y SECURITY DEFINER no cambia el
  -- JWT que el guard consulta. Se abre su compuerta explícita, y solo aquí: el
  -- ámbito es la transacción (tercer argumento `true`) y las dos únicas
  -- escrituras que siguen ya están acotadas arriba.
  perform set_config('app.trusted', 'on', true);

  update shipments
     set status = 'delivered',
         delivered_at = now(),
         proof_image_url = coalesce(p_proof_path, proof_image_url),
         received_by = p_received_by
   where id = p_shipment_id;

  update orders
     set status = 'delivered'
   where id = v_order_id
     and status = 'shipped';   -- solo se entrega lo que salió

  perform set_config('app.trusted', 'off', true);
end;
$function$
;

do $post$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- SEC-C3 (143) aplicada y en su versión esperada: la 144 solo tiene sentido encima de ella.
  if to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is null
     or md5(pg_get_functiondef('public._sec_c3_alcance_doctor(uuid)'::regprocedure)) <> 'a02824e5ebbc6d46a57504c1c9824431'
     or (select string_agg(policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname)
           from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%')
        is distinct from 'proofs_insert=d44f6a17bd492a78d2ab9f5c6e5304aa,proofs_owner_delete=6f712015ffc47aa269fddd6b45f7a1a8,proofs_owner_write=6f712015ffc47aa269fddd6b45f7a1a8,proofs_read=63f31185a559c5b0277167ea346ba4c0' then
    raise exception 'SEC-C3b down post: SEC-C3 (143) no está aplicada en su versión esperada';
  end if;
  -- Las dos funciones: una sola firma cada una, la versión esperada, dueño, SECURITY DEFINER, search_path y permisos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega')) <> 2
     or to_regprocedure('public.shipments_guard()') is null or to_regprocedure('public.confirmar_entrega(uuid,text,text)') is null
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> '1e31cbc3ff2cd1e22e94d2e64584d617'
     or md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) <> '312b5ba18dac4f4a9419e1aaff4e80cb' then
    raise exception 'SEC-C3b down post: shipments_guard / confirmar_entrega no quedaron idénticas a producción';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('public.shipments_guard()'::regprocedure, 'public.confirmar_entrega(uuid,text,text)'::regprocedure)
              and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                   or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select prorettype::regtype::text from pg_proc where oid = 'public.shipments_guard()'::regprocedure) <> 'trigger'
     or (select prorettype::regtype::text from pg_proc where oid = 'public.confirmar_entrega(uuid,text,text)'::regprocedure) <> 'void'
     or has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') then
    raise exception 'SEC-C3b down post: cambió el dueño, SECURITY DEFINER, el search_path, el retorno o los permisos de las funciones';
  end if;
  -- shipments: los mismos dos disparadores (habilitados) y las mismas cuatro políticas. Nada más escribe la tabla por otra vía.
  select string_agg(t.tgname || ':' || t.tgtype || ':' || p.proname || ':' || t.tgenabled::text, ',' order by t.tgname) into v
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.shipments'::regclass and not t.tgisinternal;
  if v is distinct from 'shipments_audit_trigger:21:log_audit:O,shipments_guard_trg:19:shipments_guard:O' then
    raise exception 'SEC-C3b down post: los disparadores de shipments no son los auditados (%)', v;
  end if;
  select string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) into v
    from pg_policies where schemaname = 'public' and tablename = 'shipments';
  if v is distinct from 'shipments_delete_admin:DELETE:5bcc703ac8a5985e6af92e14b0c56ef7,shipments_insert_ops:INSERT:241a43c125bd5eeab2f3d423ce0b991d,shipments_select_scoped:SELECT:be20dba7962e591bc813a2c2060b275c,shipments_update_scoped:UPDATE:faab6ff4b240da8f2b5ba52d600f463f'
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3b down post: las políticas de shipments no son las auditadas (%)', v;
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.shipments'::regclass and not attisdropped
        and attname in ('status', 'load_confirmed_at', 'incident', 'delivered_at', 'proof_image_url', 'received_by', 'driver_id', 'order_id')) <> 8
     or (select count(*) from pg_attribute where attrelid = 'storage.objects'::regclass and not attisdropped and attname in ('bucket_id', 'name', 'owner', 'owner_id')) <> 4 then
    raise exception 'SEC-C3b down post: faltan columnas de shipments o de storage.objects de las que depende el control';
  end if;
  -- Las piezas nuevas no deben existir todavía.
  if to_regclass('public.shipments_proof_unica') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3b_proteger_evidencia')
     or exists (select 1 from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname = 'sec_c3b_proteger_evidencia') then
    raise exception 'SEC-C3b down post: el índice, la función o el disparador de SEC-C3b siguen existiendo';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
