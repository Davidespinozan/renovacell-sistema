-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C3b (migración 144) · CX-SEC-01 / F3 · INTEGRIDAD DE ENVÍOS Y EVIDENCIAS DE ENTREGA
--   Va en paquete con SEC-C3 (143): sin esta migración, los controles de chofer de la 143 se eluden.
--   Hallazgos (revisión independiente, reproducidos en cluster desechable; causa raíz ya presente en producción):
--     · shipments_guard solo congelaba pedido, chofer, paquetería y guía. El chofer asignado escribía TODO lo demás por
--       UPDATE directo: reabría un envío entregado (y con eso recuperaba el contacto del doctor y el permiso de subir),
--       apuntaba proof_image_url a la foto de otro chofer para leerla, quitaba la referencia de su prueba para borrarla o
--       sustituirla, y reescribía receptor, fecha y destinatario de una entrega cerrada.
--     · confirmar_entrega autorizaba con `not (chofer = auth.uid() or <rol>)`: en un envío SIN chofer (paquetería) la
--       igualdad da NULL y la compuerta de la función no rechazaba a nadie; lo único que detenía a un tercero era el
--       candado del disparador, más abajo. No validaba el estado previo ni la evidencia (aceptaba cualquier texto como
--       ruta, también la foto de otro chofer).
--   Cambios:
--     · shipments_guard    → Dirección/Almacén/Empaque y el rechazo a terceros, SIN CAMBIO. Chofer asignado: un envío
--                            entregado o cancelado es inmutable; por escritura directa solo cambia estado, carga confirmada
--                            e incidencia, y solo en los pasos del flujo real: despachado→en reparto (confirmar carga) y
--                            despachado/en reparto/incidencia→incidencia (reportar o actualizar). Resolver una incidencia
--                            sigue siendo de Dirección/Almacén. "Entregado" solo llega por confirmar_entrega.
--     · confirmar_entrega  → misma firma, retorno y permisos. Autorización NULL-safe (chofer asignado con rol vigente, o
--                            Dirección/Almacén/Empaque); candado de fila; el chofer entrega desde en reparto o incidencia;
--                            un cancelado no se entrega; la evidencia, si viene, debe ser un archivo real de
--                            proofs/<archivo>, subido por el chofer del envío o por quien cierra (autoría que escribe
--                            Storage, no el cliente) y no ser la prueba de otro envío. Repetir sobre un envío ya
--                            entregado no cambia nada.
--     · shipments_proof_unica → índice único: una evidencia pertenece a un solo envío (también ante carreras).
--     · sec_c3b_proteger_evidencia (disparador en storage.objects, solo bucket proofs) → la prueba registrada de un envío
--                            no la borra ni la reemplaza una sesión de usuario que no sea Dirección, tampoco en carrera
--                            con el cierre.
--   Efecto documentado: una llamada sin sesión de usuario (service_role) se rechaza en la propia función (antes la
--   rechazaba el disparador; nadie la consume). El frontend no cambia: el chofer ya cierra por confirmar_entrega y sus escrituras directas
--   son exactamente las permitidas.
--   Sin cambios de datos, políticas RLS ni otras funciones. Rollback: supabase/rollback/sec_c3b/99_down.sql (⚠️ REABRE).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
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
    raise exception 'SEC-C3b: SEC-C3 (143) no está aplicada en su versión esperada';
  end if;
  -- Las dos funciones: una sola firma cada una, la versión esperada, dueño, SECURITY DEFINER, search_path y permisos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega')) <> 2
     or to_regprocedure('public.shipments_guard()') is null or to_regprocedure('public.confirmar_entrega(uuid,text,text)') is null
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> '1e31cbc3ff2cd1e22e94d2e64584d617'
     or md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) <> '312b5ba18dac4f4a9419e1aaff4e80cb' then
    raise exception 'SEC-C3b: shipments_guard / confirmar_entrega no son la versión auditada (ya aplicada o drift)';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('public.shipments_guard()'::regprocedure, 'public.confirmar_entrega(uuid,text,text)'::regprocedure)
              and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                   or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select prorettype::regtype::text from pg_proc where oid = 'public.shipments_guard()'::regprocedure) <> 'trigger'
     or (select prorettype::regtype::text from pg_proc where oid = 'public.confirmar_entrega(uuid,text,text)'::regprocedure) <> 'void'
     or has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') then
    raise exception 'SEC-C3b: cambió el dueño, SECURITY DEFINER, el search_path, el retorno o los permisos de las funciones';
  end if;
  -- shipments: los mismos dos disparadores (habilitados) y las mismas cuatro políticas. Nada más escribe la tabla por otra vía.
  select string_agg(t.tgname || ':' || t.tgtype || ':' || p.proname || ':' || t.tgenabled::text, ',' order by t.tgname) into v
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.shipments'::regclass and not t.tgisinternal;
  if v is distinct from 'shipments_audit_trigger:21:log_audit:O,shipments_guard_trg:19:shipments_guard:O' then
    raise exception 'SEC-C3b: los disparadores de shipments no son los auditados (%)', v;
  end if;
  select string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) into v
    from pg_policies where schemaname = 'public' and tablename = 'shipments';
  if v is distinct from 'shipments_delete_admin:DELETE:5bcc703ac8a5985e6af92e14b0c56ef7,shipments_insert_ops:INSERT:241a43c125bd5eeab2f3d423ce0b991d,shipments_select_scoped:SELECT:be20dba7962e591bc813a2c2060b275c,shipments_update_scoped:UPDATE:faab6ff4b240da8f2b5ba52d600f463f'
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3b: las políticas de shipments no son las auditadas (%)', v;
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.shipments'::regclass and not attisdropped
        and attname in ('status', 'load_confirmed_at', 'incident', 'delivered_at', 'proof_image_url', 'received_by', 'driver_id', 'order_id')) <> 8
     or (select count(*) from pg_attribute where attrelid = 'storage.objects'::regclass and not attisdropped and attname in ('bucket_id', 'name', 'owner', 'owner_id')) <> 4 then
    raise exception 'SEC-C3b: faltan columnas de shipments o de storage.objects de las que depende el control';
  end if;
  -- Las piezas nuevas no deben existir todavía.
  if to_regclass('public.shipments_proof_unica') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3b_proteger_evidencia')
     or exists (select 1 from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname = 'sec_c3b_proteger_evidencia') then
    raise exception 'SEC-C3b: el índice, la función o el disparador de SEC-C3b ya existen (ya aplicada o drift)';
  end if;
  -- Ninguna evidencia repetida entre envíos (el índice único no podría crearse y habría que decidir caso por caso).
  if exists (select 1 from public.shipments where proof_image_url is not null group by proof_image_url having count(*) > 1) then
    raise exception 'SEC-C3b: hay envíos que comparten la misma evidencia; resolver antes de aplicar';
  end if;
  -- Quien aplica (y será dueño de las funciones) debe poder leer y bloquear storage.objects sin que RLS le oculte filas,
  -- y crear el disparador. Si no, la validación de evidencia rechazaría todo o no se instalaría: mejor no aplicar.
  if not has_table_privilege(current_user, 'storage.objects', 'select') or not has_table_privilege(current_user, 'storage.objects', 'update')
     or not has_table_privilege(current_user, 'storage.objects', 'trigger') or current_user <> 'postgres'
     or not ((select rolsuper or rolbypassrls from pg_roles where rolname = current_user)
             or (select relowner = current_user::regrole from pg_class where oid = 'storage.objects'::regclass)) then
    raise exception 'SEC-C3b: postgres no puede leer/bloquear storage.objects sin RLS o no puede crear el disparador';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

-- ── 1 · Una evidencia, un envío ───────────────────────────────────────────────────────────────────
--   Por huella (md5) y no por el texto: una ruta de evidencia heredada puede ser larga y no cabría en un índice.
create unique index shipments_proof_unica on public.shipments (md5(proof_image_url)) where proof_image_url is not null;

-- ── 2 · Candado de envíos ─────────────────────────────────────────────────────────────────────────
--   Dirección, Almacén y Empaque: SIN CAMBIO. Quien no es staff ni el chofer asignado: SIN CAMBIO (rechazado).
--   Chofer asignado, por escritura directa: solo confirma su carga o reporta una incidencia; nada más.
create or replace function public.shipments_guard()
returns trigger language plpgsql security definer set search_path = public as $function$
DECLARE
  r text := public.auth_role();
  k constant text[] := array['status', 'load_confirmed_at', 'incident'];
BEGIN
  IF r = 'admin' OR r IN ('warehouse','packing') THEN
    RETURN NEW;
  END IF;

  IF r = 'driver' AND OLD.driver_id = auth.uid() THEN
    -- Un envío entregado o cancelado es inmutable para el chofer (ni reabrirlo, ni tocar receptor, fecha o evidencia).
    IF OLD.status IN ('delivered', 'cancelado') THEN
      RAISE EXCEPTION 'ENVIO_CERRADO: un envío entregado o cancelado ya no se modifica';
    END IF;

    -- Cierre de entrega: SOLO dentro de confirmar_entrega (que deja su marca para ESTE envío y la retira al terminar),
    -- y solo con las columnas del cierre.
    IF coalesce(current_setting('app.sec_c3b_entrega', true), '') = OLD.id::text THEN
      IF NEW.status = 'delivered'
         AND (to_jsonb(NEW) - array['status', 'delivered_at', 'proof_image_url', 'received_by'])
             = (to_jsonb(OLD) - array['status', 'delivered_at', 'proof_image_url', 'received_by']) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'No autorizado: cierre de entrega fuera de contrato';
    END IF;

    -- Escritura directa: cualquier columna fuera de estado / carga confirmada / incidencia queda como estaba
    -- (pedido, chofer, guía, destinatario, receptor, fecha de entrega, evidencia, costos… y las que se agreguen después).
    IF (to_jsonb(NEW) - k) IS DISTINCT FROM (to_jsonb(OLD) - k) THEN
      RAISE EXCEPTION 'No autorizado: el chofer solo confirma su carga o reporta una incidencia';
    END IF;

    -- Transiciones del flujo real: confirmar la carga, o reportar / actualizar una incidencia.
    IF OLD.status = 'despachado' AND NEW.status = 'out_for_delivery' AND NEW.incident IS NOT DISTINCT FROM OLD.incident THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'out_for_delivery' AND NEW.status = 'out_for_delivery' AND NEW.incident IS NOT DISTINCT FROM OLD.incident THEN
      NEW.load_confirmed_at := OLD.load_confirmed_at;   -- reintento de "confirmar carga": no cambia nada
      RETURN NEW;
    END IF;
    IF OLD.status IN ('despachado', 'out_for_delivery', 'incident') AND NEW.status = 'incident'
       AND NEW.incident IS NOT NULL AND NEW.load_confirmed_at IS NOT DISTINCT FROM OLD.load_confirmed_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'TRANSICION_NO_PERMITIDA: de % a % no es un paso del chofer', OLD.status, NEW.status;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END;
$function$;

-- ── 3 · Cierre de entrega ─────────────────────────────────────────────────────────────────────────
--   Misma firma, retorno y permisos. Cambia: autorización NULL-safe en la propia función (antes, en un envío SIN chofer
--   solo el disparador detenía a un tercero), estado previo válido, evidencia verificada contra Storage y candado de fila.
create or replace function public.confirmar_entrega(p_shipment_id uuid, p_proof_path text default null, p_received_by text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_staff  boolean;
  v_path   text := nullif(btrim(p_proof_path), '');
  s        public.shipments;
begin
  if v_uid is null then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;
  v_rol := public.auth_role();          -- lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  v_staff := v_rol in ('admin', 'warehouse', 'packing');

  -- Candado de fila: dos cierres simultáneos del mismo envío se atienden uno tras otro.
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'El envío no existe';
  end if;

  -- Solo el chofer asignado (con rol de chofer vigente), o Almacén/Empaque/Dirección desde el escritorio.
  if not (v_staff or (v_rol = 'driver' and coalesce(s.driver_id = v_uid, false))) then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;

  -- La evidencia es obligatoria: sin quién recibió, no hay entrega comprobable.
  if coalesce(btrim(p_received_by), '') = '' then
    raise exception 'Falta el nombre de quien recibió';
  end if;

  if s.status = 'delivered' then
    return; -- idempotente: reintento del celular sin señal no rompe nada (ni cambia receptor, fecha o evidencia)
  end if;
  if s.status = 'cancelado' then
    raise exception 'ENVIO_CANCELADO: un envío cancelado no se entrega';
  end if;
  -- El chofer entrega lo que ya trae a bordo: en reparto, o con una incidencia abierta.
  if not v_staff and s.status not in ('out_for_delivery', 'incident') then
    raise exception 'ESTADO_INVALIDO: confirma tu carga antes de entregar';
  end if;

  -- Evidencia: debe ser un archivo REAL de proofs/<archivo>, subido por el chofer del envío (o por quien cierra), y no
  -- ser ya la prueba de otro envío. La autoría la escribe Storage (owner / owner_id), no el cliente. Un solo mensaje
  -- para todos los casos: no se revela si un archivo ajeno existe.
  if v_path is not null then
    perform 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = v_path for share;   -- un borrado en curso espera
    if not found
       or (storage.foldername(v_path))[1] is distinct from 'proofs'
       or array_length(storage.foldername(v_path), 1) is distinct from 1
       or exists (select 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = v_path
                   and not ( coalesce(o.owner = v_uid, false) or coalesce(o.owner_id = v_uid::text, false)
                             or (v_staff and s.driver_id is not null
                                 and (coalesce(o.owner = s.driver_id, false) or coalesce(o.owner_id = s.driver_id::text, false))) ))
       or exists (select 1 from public.shipments x where md5(x.proof_image_url) = md5(v_path) and x.proof_image_url = v_path and x.id <> s.id) then
      raise exception 'EVIDENCIA_INVALIDA: la foto no existe, no la subiste tú o ya es la prueba de otra entrega';
    end if;
  end if;

  -- `orders_guard()` no reconoce al rol chofer y SECURITY DEFINER no cambia el JWT que el guard consulta: se abre su
  -- compuerta (ámbito: la transacción) y la del candado de envíos, solo para ESTE envío, y se cierran al terminar.
  perform set_config('app.trusted', 'on', true);
  perform set_config('app.sec_c3b_entrega', s.id::text, true);

  begin
    update public.shipments
       set status = 'delivered',
           delivered_at = now(),
           proof_image_url = coalesce(v_path, proof_image_url),
           received_by = p_received_by
     where id = s.id;
  exception when unique_violation then
    perform set_config('app.sec_c3b_entrega', '', true);
    perform set_config('app.trusted', 'off', true);
    raise exception 'EVIDENCIA_INVALIDA: la foto no existe, no la subiste tú o ya es la prueba de otra entrega';
  end;

  update public.orders
     set status = 'delivered'
   where id = s.order_id
     and status = 'shipped';   -- solo se entrega lo que salió

  perform set_config('app.sec_c3b_entrega', '', true);
  perform set_config('app.trusted', 'off', true);
end;
$function$;

-- ── 4 · La prueba de una entrega no se borra ni se reemplaza ──────────────────────────────────────
--   Las políticas de proofs (143) ya lo impiden, pero una política con subconsulta no ve un cierre que confirma mientras
--   el borrado espera: este disparador corre DESPUÉS de esa espera y con datos frescos. Solo actúa en el bucket proofs,
--   solo sobre un archivo que ya es prueba de un envío y solo frente a una sesión de usuario que no es Dirección;
--   service_role y los procesos internos de Storage (sin sesión de usuario) no se ven afectados.
create function public._sec_c3b_proteger_evidencia() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null
     and exists (select 1 from public.shipments s where md5(s.proof_image_url) = md5(old.name) and s.proof_image_url = old.name)
     and public.auth_role() <> 'admin' then
    if tg_op = 'DELETE'
       or (to_jsonb(new) - array['last_accessed_at', 'updated_at']) is distinct from (to_jsonb(old) - array['last_accessed_at', 'updated_at']) then
      raise exception 'EVIDENCIA_PROTEGIDA: la prueba de una entrega no se borra ni se reemplaza' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
revoke all on function public._sec_c3b_proteger_evidencia() from public, anon, authenticated;

create trigger sec_c3b_proteger_evidencia before update or delete on storage.objects
  for each row when (old.bucket_id = 'proofs') execute function public._sec_c3b_proteger_evidencia();

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
    raise exception 'SEC-C3b post: SEC-C3 (143) no está aplicada en su versión esperada';
  end if;
  -- Las dos funciones: una sola firma cada una, la versión esperada, dueño, SECURITY DEFINER, search_path y permisos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega')) <> 2
     or to_regprocedure('public.shipments_guard()') is null or to_regprocedure('public.confirmar_entrega(uuid,text,text)') is null
     or md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) <> 'b1e791b99ca8043cb1e2913e0b294600'
     or md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) <> '3da25f3db1514408463b5fb38f61d0b6' then
    raise exception 'SEC-C3b post: shipments_guard / confirmar_entrega no quedaron como se diseñó';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('public.shipments_guard()'::regprocedure, 'public.confirmar_entrega(uuid,text,text)'::regprocedure)
              and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                   or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select prorettype::regtype::text from pg_proc where oid = 'public.shipments_guard()'::regprocedure) <> 'trigger'
     or (select prorettype::regtype::text from pg_proc where oid = 'public.confirmar_entrega(uuid,text,text)'::regprocedure) <> 'void'
     or has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') then
    raise exception 'SEC-C3b post: cambió el dueño, SECURITY DEFINER, el search_path, el retorno o los permisos de las funciones';
  end if;
  -- shipments: los mismos dos disparadores (habilitados) y las mismas cuatro políticas. Nada más escribe la tabla por otra vía.
  select string_agg(t.tgname || ':' || t.tgtype || ':' || p.proname || ':' || t.tgenabled::text, ',' order by t.tgname) into v
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.shipments'::regclass and not t.tgisinternal;
  if v is distinct from 'shipments_audit_trigger:21:log_audit:O,shipments_guard_trg:19:shipments_guard:O' then
    raise exception 'SEC-C3b post: los disparadores de shipments no son los auditados (%)', v;
  end if;
  select string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) into v
    from pg_policies where schemaname = 'public' and tablename = 'shipments';
  if v is distinct from 'shipments_delete_admin:DELETE:5bcc703ac8a5985e6af92e14b0c56ef7,shipments_insert_ops:INSERT:241a43c125bd5eeab2f3d423ce0b991d,shipments_select_scoped:SELECT:be20dba7962e591bc813a2c2060b275c,shipments_update_scoped:UPDATE:faab6ff4b240da8f2b5ba52d600f463f'
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3b post: las políticas de shipments no son las auditadas (%)', v;
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.shipments'::regclass and not attisdropped
        and attname in ('status', 'load_confirmed_at', 'incident', 'delivered_at', 'proof_image_url', 'received_by', 'driver_id', 'order_id')) <> 8
     or (select count(*) from pg_attribute where attrelid = 'storage.objects'::regclass and not attisdropped and attname in ('bucket_id', 'name', 'owner', 'owner_id')) <> 4 then
    raise exception 'SEC-C3b post: faltan columnas de shipments o de storage.objects de las que depende el control';
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
    raise exception 'SEC-C3b post: el índice, la función o el disparador de SEC-C3b no quedaron como se diseñó';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
