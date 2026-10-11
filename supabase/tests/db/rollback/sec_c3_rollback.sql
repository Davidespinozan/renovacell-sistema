-- SEC-C3 (143) · el down restaura doctor_directory, staff_directory y las cuatro políticas de proofs EXACTAMENTE como en
-- producción antes de la 143 (misma huella, dueño, opciones y permisos), sin tocar datos ni objetos. Revertir REABRE los
-- hallazgos (se demuestra abajo). Después, 143 + 144 vuelven a aplicar limpias sobre ese estado.
-- Paquete: primero se revierte la 144 (el down de la 143 se niega si sigue aplicada; ver sec_c3b_rollback.sql).
begin;
create temp table _secc3 as select (select count(*) from storage.objects) o, (select count(*) from public.orders) p, (select count(*) from public.shipments) s,
  (select count(*) from pg_policies where schemaname = 'storage') ps, (select count(*) from pg_policies where schemaname = 'public') pp;
\ir ../../../rollback/sec_c3b/99_down.sql
\ir ../../../rollback/sec_c3/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); v_nadie uuid := gen_random_uuid(); posX uuid := tests.user('pos'); dU uuid := tests.user('doctor'); leyo boolean; personal boolean; subio boolean := false; vio boolean;
begin
  perform set_config('search_path', 'public', true);
  perform tests.ok(md5(pg_get_viewdef('public.doctor_directory'::regclass)) = 'fe1658e03a730ad5e7a2206b9228e271' and md5(pg_get_viewdef('public.staff_directory'::regclass)) = '35a46fe265e682bf73db7b015c92205f',
    '143 down · doctor_directory y staff_directory idénticas a producción (md5)');
  perform tests.ok((select string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || permissive || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%')
                   = 'proofs_insert:INSERT:{authenticated}:PERMISSIVE:f151de69ad525e7a5dbdcc8068d58490,proofs_owner_delete:DELETE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,proofs_owner_write:UPDATE:{authenticated}:PERMISSIVE:4ab2424478c1987a042ef20ab1da908e,proofs_read:SELECT:{authenticated}:PERMISSIVE:a35a5b15e08b7f2a8e1d1addc7e8949a',
    '143 down · las cuatro políticas de proofs idénticas a producción (md5, comando, rol)');
  perform set_config('search_path', '"$user", public, extensions', true);
  perform tests.ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3_alcance_doctor'), '143 down · la función auxiliar ya no existe');
  perform tests.ok((select count(*) = 2 and bool_and(relowner = 'postgres'::regrole and reloptions is null and has_table_privilege('authenticated', oid, 'select') and not has_table_privilege('anon', oid, 'select'))
                    from pg_class where oid in ('public.doctor_directory'::regclass, 'public.staff_directory'::regclass)), '143 down · dueño, opciones (sin security_barrier) y permisos como en producción');
  perform tests.ok((select o = (select count(*) from storage.objects) and p = (select count(*) from public.orders) and s = (select count(*) from public.shipments)
                      and ps = (select count(*) from pg_policies where schemaname = 'storage') and pp = (select count(*) from pg_policies where schemaname = 'public') from _secc3),
    '143 down · sin cambios de objetos, pedidos, envíos ni número de políticas');
  -- El down reabre los hallazgos (documentado): una cuenta SIN PERFIL vuelve a leer contacto de doctores, personal y fotos; un pos vuelve a subir una "INE".
  perform tests.act_as_service(); perform set_config('app.trusted', 'on', true);
  update public.profiles set verified = false, meta = coalesce(meta, '{}'::jsonb) || '{"phone":"667-RB","address":"Calle RB"}' where id = dU;
  perform set_config('app.trusted', 'off', true);
  insert into storage.objects (bucket_id, name) values ('proofs', 'proofs/rb.png');
  perform tests.act_as(v_nadie);
  select exists (select 1 from public.doctor_directory where id = dU and meta ->> 'phone' = '667-RB'), exists (select 1 from public.staff_directory where id = posX),
         exists (select 1 from storage.objects where bucket_id = 'proofs' and name = 'proofs/rb.png') into leyo, personal, vio;
  perform tests.act_as(posX);
  begin insert into storage.objects (bucket_id, name, owner) values ('proofs', 'identity/' || dU || '/ine-front.jpg', posX); subio := true; exception when others then subio := false; end;
  perform tests.act_as_owner();
  perform tests.ok(leyo and personal, '143 down · REABRE los directorios: una cuenta sin perfil vuelve a leer teléfono y dirección de un doctor y el directorio del personal');
  perform tests.ok(vio and subio, '143 down · REABRE proofs: una cuenta sin perfil vuelve a ver fotos de entrega y un pos vuelve a subir a identity/ (por eso no se revierte sin decisión)');
end $t$;
-- La 143 vuelve a aplicar limpia sobre el estado revertido (sus guardas pre y post pasan) y vuelve a cerrar.
\ir ../../../migrations/20261126120000_sec_c_c3_directorios_proofs.sql
\ir ../../../migrations/20261127120000_sec_c_c3b_integridad_envios.sql
do $t$
declare v_nadie uuid := gen_random_uuid(); n int;
begin
  perform tests.act_as(v_nadie);
  select (select count(*) from public.doctor_directory) + (select count(*) from public.staff_directory) + (select count(*) from storage.objects where bucket_id = 'proofs') into n;
  perform tests.act_as_owner();
  perform tests.ok(n = 0 and (select reloptions = array['security_barrier=true'] from pg_class where oid = 'public.doctor_directory'::regclass), '143 · reaplicada tras el down: vuelve a cerrar (cuenta sin perfil: nada)');
end $t$;
rollback;
