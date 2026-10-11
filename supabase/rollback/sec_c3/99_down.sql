-- SEC-C3 (143) · down: restaura doctor_directory, staff_directory y las cuatro políticas de proofs EXACTAMENTE como en
-- producción antes de la 143 (misma huella, dueño, opciones y permisos) y elimina la función auxiliar. No toca tablas,
-- datos ni objetos de Storage.
-- ⚠️ REABRE LOS HALLAZGOS: cualquier cuenta no-doctor (incluida una SIN PERFIL) vuelve a leer teléfono y dirección de todos
-- los doctores, todo el directorio del personal y todas las fotos de entrega, y vuelve a poder subir a identity/ y
-- transfers/. No revertir sin decisión.
-- Orden del paquete: primero se revierte SEC-C3b (144). Con la 144 puesta, este down dejaría su disparador y su candado
-- apoyados en políticas que ya no existen.
do $orden$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3b_proteger_evidencia') then
    raise exception 'SEC-C3 down: SEC-C3b (144) sigue aplicada; revertir primero supabase/rollback/sec_c3b/99_down.sql';
  end if;
end $orden$;
do $pre$
declare v_sp text := current_setting('search_path'); v_bad text;
begin
  -- Las huellas de vistas y políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  if md5(pg_get_viewdef('public.doctor_directory'::regclass)) <> '54ee2e9db656f55e56670ee7478086ea'
     or md5(pg_get_viewdef('public.staff_directory'::regclass)) <> '79409365cc8049f6db6daf37abd18e02' then
    raise exception 'SEC-C3 down: doctor_directory / staff_directory no están en el estado SEC-C3 esperado; no se revierte sobre un estado desconocido';
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
    raise exception 'SEC-C3 down: cambió el dueño, las opciones, las columnas o los permisos de los directorios';
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
    raise exception 'SEC-C3 down: _sec_c3_alcance_doctor no quedó como se diseñó o no es la versión SEC-C3';
  end if;
  -- Las cuatro políticas de proofs, y solo esas cuatro, con la huella esperada.
  select string_agg(x.policyname || '=' || x.h, ',' order by x.policyname) into v_bad
    from (select policyname, cmd || ':' || roles::text || ':' || permissive || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')) as h
            from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%') x;
  if v_bad is distinct from 'proofs_insert=INSERT:{authenticated}:PERMISSIVE:d44f6a17bd492a78d2ab9f5c6e5304aa,proofs_owner_delete=DELETE:{authenticated}:PERMISSIVE:6f712015ffc47aa269fddd6b45f7a1a8,'
                         || 'proofs_owner_write=UPDATE:{authenticated}:PERMISSIVE:6f712015ffc47aa269fddd6b45f7a1a8,proofs_read=SELECT:{authenticated}:PERMISSIVE:63f31185a559c5b0277167ea346ba4c0' then
    raise exception 'SEC-C3 down: las políticas de proofs no están en el estado SEC-C3 esperado; no se revierte sobre un estado desconocido (%)', v_bad;
  end if;
  -- Ninguna OTRA política de storage.objects puede abrir proofs por otra vía (las permisivas se suman con OR):
  -- todas deben filtrar por bucket y ninguna puede nombrar el bucket proofs.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'proofs%'
              and ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id = %'
                   or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%proofs%')) then
    raise exception 'SEC-C3 down: otra política de storage.objects no filtra por bucket o nombra proofs';
  end if;
  -- Prerrequisitos: bucket privado, RLS activa y las piezas de las que depende la autorización.
  if not exists (select 1 from storage.buckets where id = 'proofs' and public is false) then raise exception 'SEC-C3 down: el bucket proofs no existe o es público'; end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then raise exception 'SEC-C3 down: storage.objects sin RLS'; end if;
  if md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then raise exception 'SEC-C3 down: auth_role() no es la versión auditada'; end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') is distinct from '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipments' and cmd in ('SELECT', 'ALL')) <> 1
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3 down: la visibilidad de shipments (de la que depende quién ve una prueba de entrega) no es la auditada';
  end if;
  if to_regclass('public.cc_cartera') is null or not exists (select 1 from pg_attribute where attrelid = 'public.cc_cartera'::regclass and attname = 'seller_profile_id')
     or not exists (select 1 from pg_attribute where attrelid = 'public.shipments'::regclass and attname = 'proof_image_url') then
    raise exception 'SEC-C3 down: faltan cc_cartera.seller_profile_id o shipments.proof_image_url';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

create or replace view public.doctor_directory as
select p.id,
       coalesce(nullif(p.meta ->> 'name', ''), nullif(p.full_name, ''), 'Doctor') as name,
       p.organization,
       p.verified,
       jsonb_build_object('phone', p.meta ->> 'phone', 'address', p.meta ->> 'address', 'city', p.meta ->> 'city', 'specialty', p.meta ->> 'specialty') as meta
  from public.profiles p
 where p.role_id = 'doctor' and public.auth_role() <> 'doctor';
alter view public.doctor_directory reset (security_barrier);

create or replace view public.staff_directory as
select p.id,
       coalesce(nullif(p.meta ->> 'name', ''), nullif(p.full_name, ''), 'Usuario') as name,
       p.meta ->> 'avatar_url' as avatar_url,
       p.role_id
  from public.profiles p
 where p.role_id <> 'doctor' and public.auth_role() <> 'doctor';
alter view public.staff_directory reset (security_barrier);

drop function public._sec_c3_alcance_doctor(uuid);

drop policy proofs_read on storage.objects;
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and (public.auth_role() = any (array['admin','billing','comm'])
         or ((storage.foldername(name))[1] = 'proofs' and public.auth_role() <> 'doctor')));
drop policy proofs_insert on storage.objects;
create policy proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and public.auth_role() <> 'doctor');
drop policy proofs_owner_write on storage.objects;
create policy proofs_owner_write on storage.objects for update to authenticated
  using (bucket_id = 'proofs' and (owner = auth.uid() or public.auth_role() = 'admin'));
drop policy proofs_owner_delete on storage.objects;
create policy proofs_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (owner = auth.uid() or public.auth_role() = 'admin'));

do $post$
declare v_sp text := current_setting('search_path'); v_bad text;
begin
  -- Las huellas de vistas y políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  if md5(pg_get_viewdef('public.doctor_directory'::regclass)) <> 'fe1658e03a730ad5e7a2206b9228e271'
     or md5(pg_get_viewdef('public.staff_directory'::regclass)) <> '35a46fe265e682bf73db7b015c92205f' then
    raise exception 'SEC-C3 down post: doctor_directory / staff_directory no quedaron idénticas a producción';
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
    raise exception 'SEC-C3 down post: cambió el dueño, las opciones, las columnas o los permisos de los directorios';
  end if;
  -- La función auxiliar de SEC-C3 no debe existir todavía (ni con otra firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3_alcance_doctor') then
    raise exception 'SEC-C3 down post: _sec_c3_alcance_doctor ya existe (migración ya aplicada o drift)';
  end if;
  -- Las cuatro políticas de proofs, y solo esas cuatro, con la huella esperada.
  select string_agg(x.policyname || '=' || x.h, ',' order by x.policyname) into v_bad
    from (select policyname, cmd || ':' || roles::text || ':' || permissive || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')) as h
            from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%') x;
  if v_bad is distinct from 'proofs_insert=INSERT:{authenticated}:PERMISSIVE:f151de69ad525e7a5dbdcc8068d58490,proofs_owner_delete=DELETE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,'
                         || 'proofs_owner_write=UPDATE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,proofs_read=SELECT:{authenticated}:PERMISSIVE:a35a5b15e08b7f2a8e1d1addc7e8949a' then
    raise exception 'SEC-C3 down post: las políticas de proofs no quedaron idénticas a producción (%)', v_bad;
  end if;
  -- Ninguna OTRA política de storage.objects puede abrir proofs por otra vía (las permisivas se suman con OR):
  -- todas deben filtrar por bucket y ninguna puede nombrar el bucket proofs.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'proofs%'
              and ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id = %'
                   or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%proofs%')) then
    raise exception 'SEC-C3 down post: otra política de storage.objects no filtra por bucket o nombra proofs';
  end if;
  -- Prerrequisitos: bucket privado, RLS activa y las piezas de las que depende la autorización.
  if not exists (select 1 from storage.buckets where id = 'proofs' and public is false) then raise exception 'SEC-C3 down post: el bucket proofs no existe o es público'; end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then raise exception 'SEC-C3 down post: storage.objects sin RLS'; end if;
  if md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then raise exception 'SEC-C3 down post: auth_role() no es la versión auditada'; end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') is distinct from '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipments' and cmd in ('SELECT', 'ALL')) <> 1
     or not (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass) then
    raise exception 'SEC-C3 down post: la visibilidad de shipments (de la que depende quién ve una prueba de entrega) no es la auditada';
  end if;
  if to_regclass('public.cc_cartera') is null or not exists (select 1 from pg_attribute where attrelid = 'public.cc_cartera'::regclass and attname = 'seller_profile_id')
     or not exists (select 1 from pg_attribute where attrelid = 'public.shipments'::regclass and attname = 'proof_image_url') then
    raise exception 'SEC-C3 down post: faltan cc_cartera.seller_profile_id o shipments.proof_image_url';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
