-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C3 (migración 143) · CX-SEC-01 / F3 · DIRECTORIOS Y COMPROBANTES · SEGURIDAD DE LECTURAS
--   Hallazgos (auditados y reproducidos en cluster desechable; producción idéntica en definición):
--     · doctor_directory y staff_directory filtraban con `auth_role() <> 'doctor'`. auth_role() devuelve '' para una cuenta
--       SIN PERFIL, así que esa cuenta —y cualquier rol interno, chofer incluido— leía TODOS los doctores (también los no
--       verificados) con teléfono, dirección, ciudad y especialidad, y todo el directorio del personal.
--     · Bucket proofs: con el mismo `<> 'doctor'`, cualquier cuenta no-doctor (incluida una sin perfil) leía TODAS las fotos
--       de entrega y podía SUBIR a cualquier prefijo, también identity/ y transfers/ (plantar una INE o un comprobante
--       bancario falso). El autor de una foto de entrega podía modificarla o borrarla aunque ya fuera la prueba de un envío.
--   Cambios (mismas vistas, columnas, tipos, dueño y permisos; mismas cuatro políticas, mismos comandos y rol; una función
--   auxiliar nueva):
--     · doctor_directory → lista explícita de roles; sin sesión o sin perfil, nada.
--         Filas:    Dirección, Facturación, Comm, Ventas (pos), Almacén y Empaque ven a todos los doctores (nombre, clínica y
--                   verificado: lo que ya usan sus pantallas). El chofer ve solo a los doctores de SUS envíos.
--         Contacto: (meta.phone/address/city/specialty) solo Dirección; Ventas, únicamente de su cartera VALIDADA (cc_cartera,
--                   decisión D-SECC-1: Odoo, correo o teléfono no autorizan); el chofer, únicamente del doctor con un envío
--                   suyo EN CURSO (por despachar, despachado, en reparto o con incidencia abierta). Para los demás,
--                   las mismas cuatro llaves con valor null (la forma del JSON no cambia).
--     · staff_directory  → lista explícita de roles internos; sin sesión o sin perfil, nada. Mismas columnas (sin PII).
--     · proofs_read      → identity/ y transfers/: Dirección, Facturación y Comm, SIN CAMBIO. proofs/ (fotos de entrega):
--                          Almacén, Empaque y chofer solo si la foto es la prueba de un envío que ESE usuario puede ver (la
--                          RLS de shipments decide: el chofer solo los suyos); el chofer además ve lo que él subió. Ventas
--                          y las cuentas sin perfil dejan de ver fotos de entrega. El prefijo ya no autoriza por sí solo.
--     · proofs_insert    → solo proofs/<archivo> (un nivel), y solo Dirección o un chofer con un envío en curso. Nadie sube
--                          a identity/ ni transfers/ con sesión de usuario (lo hacen las Edge Functions con service_role).
--     · proofs_owner_*   → Dirección; o el chofer autor mientras la foto NO sea la prueba registrada de un envío.
--     · _sec_c3_alcance_doctor(uuid) → única pieza nueva: función auxiliar (SECURITY DEFINER, search_path fijo, sin anon)
--                          que resuelve el alcance del PROPIO llamador sobre un doctor (0 nada · 1 básico · 2 contacto).
--   NO cambia: quién ve identity/ y transfers/; service_role (Edge) sobre Storage; las URL firmadas ya emitidas (caducan
--   solas, ≤ 1 h); ningún objeto se borra ni se mueve; ninguna tabla, dato, función existente ni otra política.
--   Efecto documentado: service_role y postgres dejan de recibir filas de las dos VISTAS (auth.uid() es null); nadie las
--   consume así: leen profiles directo.
--   Rollback: supabase/rollback/sec_c3/99_down.sql (⚠️ REABRE las lecturas y las subidas).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare v_sp text := current_setting('search_path'); v_bad text;
begin
  -- Las huellas de vistas y políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  if md5(pg_get_viewdef('public.doctor_directory'::regclass)) <> 'fe1658e03a730ad5e7a2206b9228e271'
     or md5(pg_get_viewdef('public.staff_directory'::regclass)) <> '35a46fe265e682bf73db7b015c92205f' then
    raise exception 'SEC-C3: doctor_directory / staff_directory no son la versión auditada (ya aplicada o drift)';
  end if;
  -- Forma de las vistas: dueño, opciones, columnas y tipos, y permisos (authenticated solo lee; anon nada).
  if exists (select 1 from pg_class c where c.oid in ('public.doctor_directory'::regclass, 'public.staff_directory'::regclass)
              and (c.relkind <> 'v' or c.relowner <> 'postgres'::regrole or c.reloptions is distinct from null
                   or has_table_privilege('anon', c.oid, 'select') or not has_table_privilege('authenticated', c.oid, 'select')
                   or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete')))
     or (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.doctor_directory'::regclass and a.attnum > 0 and not a.attisdropped)
        <> 'id:uuid,name:text,organization:text,verified:boolean,meta:jsonb'
     or (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.staff_directory'::regclass and a.attnum > 0 and not a.attisdropped)
        <> 'id:uuid,name:text,avatar_url:text,role_id:text' then
    raise exception 'SEC-C3: cambió el dueño, las opciones, las columnas o los permisos de los directorios';
  end if;
  -- La función auxiliar de SEC-C3 no debe existir todavía (ni con otra firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3_alcance_doctor') then
    raise exception 'SEC-C3: _sec_c3_alcance_doctor ya existe (migración ya aplicada o drift)';
  end if;
  -- Las cuatro políticas de proofs, y solo esas cuatro, con la huella esperada.
  select string_agg(x.policyname || '=' || x.h, ',' order by x.policyname) into v_bad
    from (select policyname, cmd || ':' || roles::text || ':' || permissive || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')) as h
            from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%') x;
  if v_bad is distinct from 'proofs_insert=INSERT:{authenticated}:PERMISSIVE:f151de69ad525e7a5dbdcc8068d58490,proofs_owner_delete=DELETE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,'
                         || 'proofs_owner_write=UPDATE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,proofs_read=SELECT:{authenticated}:PERMISSIVE:a35a5b15e08b7f2a8e1d1addc7e8949a' then
    raise exception 'SEC-C3: las políticas de proofs no son la versión auditada (ya aplicada o drift) (%)', v_bad;
  end if;
  -- Ninguna OTRA política de storage.objects puede abrir proofs por otra vía (las permisivas se suman con OR):
  -- todas deben filtrar por bucket y ninguna puede nombrar el bucket proofs.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'proofs%'
              and ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id = %'
                   or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%proofs%')) then
    raise exception 'SEC-C3: otra política de storage.objects no filtra por bucket o nombra proofs';
  end if;
  -- Prerrequisitos: bucket privado, RLS activa y las piezas de las que depende la autorización.
  if not exists (select 1 from storage.buckets where id = 'proofs' and public is false) then raise exception 'SEC-C3: el bucket proofs no existe o es público'; end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then raise exception 'SEC-C3: storage.objects sin RLS'; end if;
  if md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then raise exception 'SEC-C3: auth_role() no es la versión auditada'; end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') is distinct from '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipments' and cmd in ('SELECT', 'ALL')) <> 1
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3: la visibilidad de shipments (de la que depende quién ve una prueba de entrega) no es la auditada';
  end if;
  if to_regclass('public.cc_cartera') is null or not exists (select 1 from pg_attribute where attrelid = 'public.cc_cartera'::regclass and attname = 'seller_profile_id')
     or not exists (select 1 from pg_attribute where attrelid = 'public.shipments'::regclass and attname = 'proof_image_url') then
    raise exception 'SEC-C3: faltan cc_cartera.seller_profile_id o shipments.proof_image_url';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

-- ── 1 · Alcance del llamador sobre un doctor ──────────────────────────────────────────────────────
--   0 = no lo ve · 1 = datos básicos (nombre, clínica, verificado) · 2 = además contacto.
--   Función y no subconsulta en la vista: así la vista sigue siendo de una sola tabla (mismo comportamiento que antes ante
--   un intento de escritura) y no queda atada a cc_cartera (los rollbacks de CC siguen pudiendo correr). Si cc_cartera no
--   existiera, Ventas se queda en 1: falla cerrado. Solo responde sobre el PROPIO llamador.
create function public._sec_c3_alcance_doctor(p_doctor uuid) returns smallint
language plpgsql stable security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_rol text;
begin
  if v_uid is null or p_doctor is null then return 0; end if;
  v_rol := public.auth_role();                       -- '' sin perfil; lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  if v_rol = 'admin' then return 2; end if;
  if v_rol = 'pos' then
    begin
      if exists (select 1 from public.cc_cartera c where c.profile_id = p_doctor and c.seller_profile_id = v_uid) then return 2; end if;
    exception when undefined_table or undefined_column then null;
    end;
    return 1;
  end if;
  if v_rol in ('billing', 'comm', 'warehouse', 'packing') then return 1; end if;
  if v_rol = 'driver' then
    if exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id
                where o.doctor_id = p_doctor and s.driver_id = v_uid
                  and s.status in ('por_despachar', 'despachado', 'out_for_delivery', 'incident', 'in_transit')) then return 2; end if;
    if exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id
                where o.doctor_id = p_doctor and s.driver_id = v_uid) then return 1; end if;
  end if;
  return 0;                                          -- sin perfil, doctor, o cualquier rol que no esté en la lista
end $fn$;
revoke all on function public._sec_c3_alcance_doctor(uuid) from public, anon;
grant execute on function public._sec_c3_alcance_doctor(uuid) to authenticated, service_role;

-- ── 2 · doctor_directory ──────────────────────────────────────────────────────────────────────────
create or replace view public.doctor_directory with (security_barrier = true) as
select p.id,
       coalesce(nullif(p.meta ->> 'name', ''), nullif(p.full_name, ''), 'Doctor') as name,
       p.organization,
       p.verified,
       case when public._sec_c3_alcance_doctor(p.id) = 2
            then jsonb_build_object('phone', p.meta ->> 'phone', 'address', p.meta ->> 'address',
                                    'city', p.meta ->> 'city', 'specialty', p.meta ->> 'specialty')
            else jsonb_build_object('phone', null, 'address', null, 'city', null, 'specialty', null)
       end as meta
  from public.profiles p
 where p.role_id = 'doctor'
   and public._sec_c3_alcance_doctor(p.id) >= 1;

-- ── 3 · staff_directory ───────────────────────────────────────────────────────────────────────────
create or replace view public.staff_directory with (security_barrier = true) as
select p.id,
       coalesce(nullif(p.meta ->> 'name', ''), nullif(p.full_name, ''), 'Usuario') as name,
       p.meta ->> 'avatar_url' as avatar_url,
       p.role_id
  from public.profiles p
 where p.role_id <> 'doctor'
   and auth.uid() is not null
   and public.auth_role() = any (array['admin', 'billing', 'comm', 'pos', 'warehouse', 'packing', 'driver']);

-- ── 4 · Storage · bucket proofs ───────────────────────────────────────────────────────────────────
drop policy proofs_read on storage.objects;
create policy proofs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs' and (
      public.auth_role() = any (array['admin', 'billing', 'comm'])
      or ( (storage.foldername(name))[1] = 'proofs' and (
             ( public.auth_role() = any (array['warehouse', 'packing', 'driver'])
               and exists (select 1 from public.shipments s where s.proof_image_url = objects.name) )
             or ( public.auth_role() = 'driver' and (owner = auth.uid() or owner_id = (auth.uid())::text) )
           ) )
    )
  );

drop policy proofs_insert on storage.objects;
create policy proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = 'proofs'
    and array_length(storage.foldername(name), 1) = 1
    and ( public.auth_role() = 'admin'
          or ( public.auth_role() = 'driver'
               and exists (select 1 from public.shipments s
                            where s.driver_id = auth.uid() and s.status = any (array['por_despachar', 'despachado', 'out_for_delivery', 'incident', 'in_transit'])) ) )
  );

drop policy proofs_owner_write on storage.objects;
create policy proofs_owner_write on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs' and (
      public.auth_role() = 'admin'
      or ( public.auth_role() = 'driver' and (owner = auth.uid() or owner_id = (auth.uid())::text)
           and (storage.foldername(name))[1] = 'proofs'
           and not exists (select 1 from public.shipments s where s.proof_image_url = objects.name) )
    )
  );

drop policy proofs_owner_delete on storage.objects;
create policy proofs_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs' and (
      public.auth_role() = 'admin'
      or ( public.auth_role() = 'driver' and (owner = auth.uid() or owner_id = (auth.uid())::text)
           and (storage.foldername(name))[1] = 'proofs'
           and not exists (select 1 from public.shipments s where s.proof_image_url = objects.name) )
    )
  );

do $post$
declare v_sp text := current_setting('search_path'); v_bad text;
begin
  -- Las huellas de vistas y políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  if md5(pg_get_viewdef('public.doctor_directory'::regclass)) <> '54ee2e9db656f55e56670ee7478086ea'
     or md5(pg_get_viewdef('public.staff_directory'::regclass)) <> '79409365cc8049f6db6daf37abd18e02' then
    raise exception 'SEC-C3 post: doctor_directory / staff_directory no quedaron como se diseñó';
  end if;
  -- Forma de las vistas: dueño, opciones, columnas y tipos, y permisos (authenticated solo lee; anon nada).
  if exists (select 1 from pg_class c where c.oid in ('public.doctor_directory'::regclass, 'public.staff_directory'::regclass)
              and (c.relkind <> 'v' or c.relowner <> 'postgres'::regrole or c.reloptions is distinct from array['security_barrier=true']
                   or has_table_privilege('anon', c.oid, 'select') or not has_table_privilege('authenticated', c.oid, 'select')
                   or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete')))
     or (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.doctor_directory'::regclass and a.attnum > 0 and not a.attisdropped)
        <> 'id:uuid,name:text,organization:text,verified:boolean,meta:jsonb'
     or (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.staff_directory'::regclass and a.attnum > 0 and not a.attisdropped)
        <> 'id:uuid,name:text,avatar_url:text,role_id:text' then
    raise exception 'SEC-C3 post: cambió el dueño, las opciones, las columnas o los permisos de los directorios';
  end if;
  -- La función auxiliar: una sola firma, la versión esperada, dueño, SECURITY DEFINER, search_path fijo y permisos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3_alcance_doctor') <> 1
     or to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is null
     or md5(pg_get_functiondef('public._sec_c3_alcance_doctor(uuid)'::regprocedure)) <> 'a02824e5ebbc6d46a57504c1c9824431'
     or exists (select 1 from pg_proc p where p.oid = 'public._sec_c3_alcance_doctor(uuid)'::regprocedure
                 and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.provolatile <> 's' or p.proconfig is distinct from array['search_path=public']
                      or p.prorettype <> 'smallint'::regtype))
     or has_function_privilege('anon', 'public._sec_c3_alcance_doctor(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public._sec_c3_alcance_doctor(uuid)', 'execute') then
    raise exception 'SEC-C3 post: _sec_c3_alcance_doctor no quedó como se diseñó o no es la versión SEC-C3';
  end if;
  -- Las cuatro políticas de proofs, y solo esas cuatro, con la huella esperada.
  select string_agg(x.policyname || '=' || x.h, ',' order by x.policyname) into v_bad
    from (select policyname, cmd || ':' || roles::text || ':' || permissive || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')) as h
            from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%') x;
  if v_bad is distinct from 'proofs_insert=INSERT:{authenticated}:PERMISSIVE:d44f6a17bd492a78d2ab9f5c6e5304aa,proofs_owner_delete=DELETE:{authenticated}:PERMISSIVE:6f712015ffc47aa269fddd6b45f7a1a8,'
                         || 'proofs_owner_write=UPDATE:{authenticated}:PERMISSIVE:6f712015ffc47aa269fddd6b45f7a1a8,proofs_read=SELECT:{authenticated}:PERMISSIVE:63f31185a559c5b0277167ea346ba4c0' then
    raise exception 'SEC-C3 post: las políticas de proofs no quedaron como se diseñó (%)', v_bad;
  end if;
  -- Ninguna OTRA política de storage.objects puede abrir proofs por otra vía (las permisivas se suman con OR):
  -- todas deben filtrar por bucket y ninguna puede nombrar el bucket proofs.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'proofs%'
              and ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id = %'
                   or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%proofs%')) then
    raise exception 'SEC-C3 post: otra política de storage.objects no filtra por bucket o nombra proofs';
  end if;
  -- Prerrequisitos: bucket privado, RLS activa y las piezas de las que depende la autorización.
  if not exists (select 1 from storage.buckets where id = 'proofs' and public is false) then raise exception 'SEC-C3 post: el bucket proofs no existe o es público'; end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then raise exception 'SEC-C3 post: storage.objects sin RLS'; end if;
  if md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then raise exception 'SEC-C3 post: auth_role() no es la versión auditada'; end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') is distinct from '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipments' and cmd in ('SELECT', 'ALL')) <> 1
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3 post: la visibilidad de shipments (de la que depende quién ve una prueba de entrega) no es la auditada';
  end if;
  if to_regclass('public.cc_cartera') is null or not exists (select 1 from pg_attribute where attrelid = 'public.cc_cartera'::regclass and attname = 'seller_profile_id')
     or not exists (select 1 from pg_attribute where attrelid = 'public.shipments'::regclass and attname = 'proof_image_url') then
    raise exception 'SEC-C3 post: faltan cc_cartera.seller_profile_id o shipments.proof_image_url';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
