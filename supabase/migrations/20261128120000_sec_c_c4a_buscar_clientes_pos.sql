-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C4-A (migración 145) · CX-SEC-01 / F3 · BÚSQUEDA MÍNIMA DE CLIENTES PARA VENTAS
--   Primer paso de SEC-C4. ESTRICTAMENTE ADITIVA: crea una función de búsqueda y su auxiliar; no cambia tablas, políticas,
--   permisos existentes ni otras funciones. Nadie la consume todavía (el frontend la adopta en C4-B) y las políticas de
--   customers / doctor_locations se restringen después (C4-C), cuando el frontend ya no dependa de leer la tabla.
--   Hallazgo que atiende (auditado en producción, reproducido en local): todo Ventas lee customers completo —correo,
--   teléfono, vendedor histórico, metadatos— y lo precarga entero para elegir un cliente.
--   Decisiones del dueño (12 oct 2026):
--     D-C4-1 · la cartera podrá asociarse a customers.id sin exigir cuenta de portal, aprobada por Dirección y con
--              historial (ampliación del modelo; NO se implementa aquí). Hasta entonces, sin cartera = solo búsqueda mínima.
--     D-C4-2 · una equivalencia histórica de Odoo es referencia; no concede acceso a contacto, expediente ni ubicaciones.
--     D-C4-3 · venta de mostrador fuera de cartera: no copiar el teléfono maestro; captura por operación (diseño en C4-E).
--     D-C4-4 · la búsqueda general devuelve SOLO identificador de cuenta, nombre y últimos 4 dígitos enmascarados. Sin ciudad.
--     D-C4-5 · encontrar una cuenta no autoriza su expediente.
--   buscar_clientes_pos(q, limite) → (customer_id, nombre, telefono_mascara)
--     · Quién: Dirección y Ventas, con sesión y rol vigente. Nadie más (ni Facturación: su vía es el expediente 360).
--     · Por nombre: al menos 3 letras (sin contar espacios), máximo 60 caracteres, sin acentos ni mayúsculas, comodines
--       tratados como texto. Por teléfono: EXACTAMENTE 4 dígitos, contra los últimos 4. Cualquier otra cadena sin
--       letras (3, 5 o más dígitos, "+52…", signos) y todo lo que traiga "@" se rechaza: no hay prefijos, números
--       completos ni correos.
--     · Máximo 20 resultados, orden fijo (empieza-por, nombre, id), sin paginación, sin conteo ni señal de "hay más".
--     · El nombre visible no arrastra contacto: un correo usado como nombre se recorta y un teléfono escrito en el nombre
--       se oculta; la búsqueda compara contra ese nombre visible. Teléfonos de menos de 8 dígitos no se muestran ni se buscan.
--     · Freno de extracción (solo Ventas): 20 búsquedas por minuto y 200 por día por usuario, con el limitador existente.
--       No impide enumerar nombres con paciencia; lo hace lento y deja el conteo por usuario en rate_limit_buckets.
--   Rollback: supabase/rollback/sec_c4a/99_down.sql (retira solo estas dos funciones; no reabre nada).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() y el limitador existente, en su versión auditada.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5'
     or to_regprocedure('public.rate_limit_hit(text,text,integer,integer,integer)') is null
     or md5(pg_get_functiondef('public.rate_limit_hit(text,text,integer,integer,integer)'::regprocedure)) <> 'ee5590f8c5a2e843c0e2ab6b52605274'
     or to_regclass('public.rate_limit_buckets') is null then
    raise exception 'SEC-C4-A: customers, auth_role() o rate_limit_hit() no son los auditados';
  end if;
  -- Las dos funciones nuevas no deben existir (con ninguna firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible')) then
    raise exception 'SEC-C4-A: buscar_clientes_pos / _c4a_nombre_visible ya existen (ya aplicada o drift)';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

-- Nombre que puede mostrarse: el nombre comercial, sin los datos de contacto que la importación dejó dentro de él
-- (un correo usado como nombre, o un teléfono escrito en el nombre).
create function public._c4a_nombre_visible(p_nombre text) returns text
language sql immutable set search_path = public as $fn$
  select case
    when p_nombre is null or btrim(p_nombre) = '' then 'Cliente sin nombre'
    when position('@' in p_nombre) > 0 then left(btrim(p_nombre), 2) || '•••'
    else regexp_replace(btrim(regexp_replace(p_nombre, '\s+', ' ', 'g')), '[0-9][0-9 ().+-]{5,}[0-9]', '•••', 'g')
  end
$fn$;
revoke all on function public._c4a_nombre_visible(text) from public, anon, authenticated, service_role;

create function public.buscar_clientes_pos(q text, limite integer default 20)
returns table (customer_id uuid, nombre text, telefono_mascara text)
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_rol  text;
  v_q    text;
  v_n    text;                    -- q normalizada: minúsculas, sin acentos
  v_pat  text;
  v_lim  int;
  v_tel  boolean;
  -- Mayúsculas acentuadas incluidas: lower() no las baja en una base con configuración regional "C".
  c_acentos constant text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_planos  constant text := 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';
begin
  -- 1 · Identidad: sesión de usuario con rol vigente de Dirección o Ventas. Sin sesión (anon, service_role) no hay búsqueda.
  if v_uid is null then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  v_rol := public.auth_role();     -- '' sin perfil; lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  if v_rol not in ('admin', 'pos') then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;

  -- 2 · Entrada: un solo mensaje para todo lo inválido (vacía, corta, larga, correo, o sin letras y que no sea 4 dígitos).
  v_q := btrim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g'));
  if char_length(v_q) > 60 or position('@' in v_q) > 0 then
    raise exception 'BUSQUEDA_INVALIDA: escribe al menos 3 letras del nombre, o los últimos 4 dígitos del teléfono' using errcode = 'invalid_parameter_value';
  end if;
  v_tel := v_q ~ '^[0-9]{4}$';
  v_n := translate(lower(v_q), c_acentos, c_planos);
  -- Por nombre: al menos 3 caracteres y alguna letra. Dígitos y signos solos (prefijos, números completos, "+52…") no.
  if not v_tel and (v_n !~ '[a-z]' or char_length(replace(v_q, ' ', '')) < 3) then
    raise exception 'BUSQUEDA_INVALIDA: escribe al menos 3 letras del nombre, o los últimos 4 dígitos del teléfono' using errcode = 'invalid_parameter_value';
  end if;
  v_lim := least(greatest(coalesce(limite, 20), 1), 20);

  -- 3 · Freno de extracción (solo Ventas): 20 búsquedas por minuto y 200 por día por usuario, sobre el limitador que ya
  --     existe. No impide enumerar nombres con paciencia; lo vuelve lento y deja el conteo por usuario a la vista.
  if v_rol = 'pos' then
    if not coalesce((public.rate_limit_hit('c4a_buscar_clientes_min', v_uid::text, 20, 60, 1) ->> 'allowed')::boolean, false)
       or not coalesce((public.rate_limit_hit('c4a_buscar_clientes_dia', v_uid::text, 200, 86400, 1) ->> 'allowed')::boolean, false) then
      raise exception 'LIMITE_DE_BUSQUEDAS: demasiadas búsquedas; espera un momento' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- 4 · Búsqueda. Solo tres columnas salen de aquí; el teléfono nunca completo.
  if v_tel then
    -- Últimos 4 dígitos EXACTOS, y solo de teléfonos con 8 dígitos o más (uno más corto quedaría revelado casi entero).
    return query
      select c.id,
             public._c4a_nombre_visible(c.full_name),
             '••••' || right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4)
        from public.customers c
       where c.active
         and length(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) >= 8
         and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4) = v_q
       order by translate(lower(public._c4a_nombre_visible(c.full_name)), c_acentos, c_planos), c.id
       limit v_lim;
    return;
  end if;

  v_pat := replace(replace(replace(v_n, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select c.id,
           public._c4a_nombre_visible(c.full_name),
           case when length(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) >= 8
                then '••••' || right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4) end
      from public.customers c
     where c.active
       and position('@' in c.full_name) = 0            -- un "nombre" que en realidad es un correo no se busca por texto
       -- se compara contra el nombre VISIBLE: un teléfono escrito dentro del nombre no se puede confirmar buscándolo
       and translate(lower(public._c4a_nombre_visible(c.full_name)), c_acentos, c_planos) like '%' || v_pat || '%' escape '\'
     order by (translate(lower(public._c4a_nombre_visible(c.full_name)), c_acentos, c_planos) like v_pat || '%' escape '\') desc,
              translate(lower(public._c4a_nombre_visible(c.full_name)), c_acentos, c_planos), c.id
     limit v_lim;
end $fn$;
revoke all on function public.buscar_clientes_pos(text, integer) from public, anon, service_role;
grant execute on function public.buscar_clientes_pos(text, integer) to authenticated;
comment on function public.buscar_clientes_pos(text, integer) is
  'SEC-C4-A · Búsqueda mínima de clientes para Ventas y Dirección: customer_id, nombre y ••••últimos 4. Encontrar una cuenta NO autoriza su expediente.';

do $post$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A post: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() y el limitador existente, en su versión auditada.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5'
     or to_regprocedure('public.rate_limit_hit(text,text,integer,integer,integer)') is null
     or md5(pg_get_functiondef('public.rate_limit_hit(text,text,integer,integer,integer)'::regprocedure)) <> 'ee5590f8c5a2e843c0e2ab6b52605274'
     or to_regclass('public.rate_limit_buckets') is null then
    raise exception 'SEC-C4-A post: customers, auth_role() o rate_limit_hit() no son los auditados';
  end if;
  -- Las dos funciones nuevas: una firma cada una, su versión, dueño, search_path fijo y permisos mínimos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible')) <> 2
     or to_regprocedure('public.buscar_clientes_pos(text,integer)') is null or to_regprocedure('public._c4a_nombre_visible(text)') is null then
    raise exception 'SEC-C4-A post: buscar_clientes_pos / _c4a_nombre_visible no quedaron como se diseñó';
  end if;
  if md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) <> '5f428aaf8e8c03147c0d07203ed4a9b4'
     or md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) <> '2996a5666d351dd2c19a4a505d847c3c'
     or exists (select 1 from pg_proc p where p.oid in ('public.buscar_clientes_pos(text,integer)'::regprocedure, 'public._c4a_nombre_visible(text)'::regprocedure)
                 and (p.proowner <> 'postgres'::regrole or p.proconfig is distinct from array['search_path=public']))
     or not (select prosecdef and provolatile = 'v' from pg_proc where oid = 'public.buscar_clientes_pos(text,integer)'::regprocedure)
     or (select prosecdef or provolatile <> 'i' from pg_proc where oid = 'public._c4a_nombre_visible(text)'::regprocedure)
     or has_function_privilege('anon', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or has_function_privilege('service_role', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or has_function_privilege('anon', 'public._c4a_nombre_visible(text)', 'execute')
     or has_function_privilege('authenticated', 'public._c4a_nombre_visible(text)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid in ('public.buscar_clientes_pos(text,integer)'::regprocedure, 'public._c4a_nombre_visible(text)'::regprocedure) and a.grantee = 0) then
    raise exception 'SEC-C4-A post: buscar_clientes_pos / _c4a_nombre_visible no quedaron como se diseñó';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
