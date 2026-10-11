-- SEC-C3b (144) · el down restaura shipments_guard y confirmar_entrega EXACTAMENTE como en producción antes de la 144 y
-- retira el índice único, el disparador de storage.objects y su función; la 143 y los datos quedan intactos. Revertir
-- REABRE los hallazgos (se demuestra abajo): con la 143 sola, sus controles de chofer se eluden. Después la 144 reaplica.
begin;
create temp table _c3b as select (select count(*) from public.shipments) s, (select count(*) from storage.objects) o, (select count(*) from public.orders) p,
  (select count(*) from pg_policies) pol, (select count(*) from pg_trigger where not tgisinternal) trg, (select count(*) from pg_indexes where schemaname = 'public') idx;
-- El down de la 143 se niega mientras la 144 siga aplicada (orden del paquete).
do $t$ begin
  perform tests.throws($q$do $x$ begin
      if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3b_proteger_evidencia') then
        raise exception 'SEC-C3 down: SEC-C3b (144) sigue aplicada; revertir primero supabase/rollback/sec_c3b/99_down.sql';
      end if; end $x$$q$, 'revertir primero', '144 · el down de la 143 exige revertir antes la 144 (misma guarda que lleva su archivo)');
end $t$;
\ir ../../../rollback/sec_c3b/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); drv uuid := tests.user('driver'); drv2 uuid := tests.user('driver'); d uuid := tests.user('doctor');
        prod uuid := tests.product(100); it jsonb; sEnt uuid; sAct uuid; reabrio boolean := false; contacto boolean; leyo boolean; cerro boolean := false; borro int;
begin
  it := jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 1));
  perform tests.ok(md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = '1e31cbc3ff2cd1e22e94d2e64584d617'
               and md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) = '312b5ba18dac4f4a9419e1aaff4e80cb', '144 down · shipments_guard y confirmar_entrega idénticas a producción (md5)');
  perform tests.ok((select count(*) = 2 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public']) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega'))
               and has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') and not has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute'),
    '144 down · dueño, SECURITY DEFINER, search_path y permisos como en producción');
  perform tests.ok(to_regclass('public.shipments_proof_unica') is null and to_regprocedure('public._sec_c3b_proteger_evidencia()') is null
               and not exists (select 1 from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname = 'sec_c3b_proteger_evidencia'), '144 down · índice, función y disparador retirados');
  perform tests.ok(to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is not null and (select reloptions = array['security_barrier=true'] from pg_class where oid = 'public.doctor_directory'::regclass),
    '144 down · la 143 (SEC-C3) no se toca');
  perform tests.ok((select s = (select count(*) from public.shipments) and o = (select count(*) from storage.objects) and p = (select count(*) from public.orders) and pol = (select count(*) from pg_policies)
                      and trg = (select count(*) from pg_trigger where not tgisinternal) + 1 and idx = (select count(*) from pg_indexes where schemaname = 'public') + 1 from _c3b),
    '144 down · sin cambios de datos ni de políticas; exactamente un disparador y un índice menos');
  -- El down reabre los hallazgos (documentado): con la 143 sola, el chofer vuelve a eludir sus controles.
  perform tests.act_as_service(); perform set_config('app.trusted', 'on', true);
  update public.profiles set meta = coalesce(meta, '{}'::jsonb) || '{"phone":"667-RB","address":"Calle RB"}' where id = d; perform set_config('app.trusted', 'off', true);
  perform tests.act_as_owner();
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values (tests.order(d, 'delivered', it), drv, 'delivered', now(), 'proofs/rb-a.png', 'R') returning id into sEnt;
  insert into public.shipments (order_id, driver_id, status) values (tests.order(d, 'shipped', it), drv, 'despachado') returning id into sAct;
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/rb-a.png', drv, drv::text), ('proofs', 'proofs/rb-b.png', drv2, drv2::text);
  perform tests.act_as(drv);
  begin update public.shipments set status = 'despachado', proof_image_url = 'proofs/rb-b.png' where id = sEnt; reabrio := found; exception when others then reabrio := false; end;
  select exists (select 1 from public.doctor_directory where id = d and meta ->> 'phone' = '667-RB'), exists (select 1 from storage.objects where name = 'proofs/rb-b.png') into contacto, leyo;
  delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/rb-a.png'; get diagnostics borro = row_count;
  -- cierre sin confirmar la carga y con la foto de OTRO chofer como evidencia
  begin perform public.confirmar_entrega(sAct, 'proofs/rb-b.png', 'cualquiera'); exception when others then null; end;
  perform tests.act_as_owner(); select status = 'delivered' and proof_image_url = 'proofs/rb-b.png' into cerro from public.shipments where id = sAct;
  perform tests.ok(reabrio and contacto, '144 down · REABRE: el chofer vuelve a reabrir una entrega cerrada y a recuperar el contacto del doctor');
  perform tests.ok(leyo and borro = 1, '144 down · REABRE: vuelve a leer la foto de otro chofer por referencia y a borrar la prueba de su entrega');
  perform tests.ok(cerro, '144 down · REABRE: el cierre vuelve a aceptar la foto de otro chofer y un envío sin carga confirmada (por eso no se revierte sin decisión)');
  -- limpiar el escenario para que la 144 reaplique sobre datos consistentes
  perform tests.act_as(v_admin); delete from public.shipments where id in (sEnt, sAct);
  perform tests.act_as_owner(); delete from storage.objects where name in ('proofs/rb-a.png', 'proofs/rb-b.png');
end $t$;
-- La 144 vuelve a aplicar limpia (guardas pre y post) y vuelve a cerrar.
\ir ../../../migrations/20261127120000_sec_c_c3b_integridad_envios.sql
do $t$
declare drv uuid := tests.user('driver'); d uuid := tests.user('doctor'); p uuid := tests.product(100); sEnt uuid;
begin
  perform tests.act_as_owner();
  insert into public.shipments (order_id, driver_id, status, delivered_at, received_by) values (tests.order(d, 'delivered', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1))), drv, 'delivered', now(), 'R') returning id into sEnt;
  perform tests.act_as(drv);
  perform tests.throws(format('update public.shipments set status = %L where id = %L', 'despachado', sEnt), 'ENVIO_CERRADO', '144 · reaplicada tras el down: vuelve a cerrar (la entrega no se reabre)');
end $t$;
rollback;
