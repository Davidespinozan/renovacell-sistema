-- CX-ENLACE (150) · el down retira el prerregistro y devuelve el ruteo, el nombre y la cola exactamente a su versión
-- anterior; todo lo demás queda igual, y la migración se puede volver a aplicar.
begin;
create temp table _cx as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias', '_cc_prerregistro_coincidencia', 'cc_visitante_prerregistrar', 'cc_puerta_chat', 'cc_contacto_de', 'cc_enlace_auto_asesor', 'cc_ruteo_pendientes', '_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cartera_cliente_al_ligar', 'cliente_vendedor_asignar', 'cliente_estado_guardar') and p.proname not like 'cliente_invitacion_%' and p.proname not in ('_puede_verificar', 'doctor_verificacion_ver', 'doctor_verificar', 'doctor_verificacion_de_conversacion', 'cc_contacto_de') and p.proname <> 'mi_verificacion' and p.proname not in ('_ligar_prerregistro', 'admin_approve_doctor')) resto,
  (select count(*) from public.prospects) n_p, (select count(*) from public.cc_visitors) n_v;
\ir ../../../rollback/continuidad/99_down.sql   -- CONTINUIDAD (156) se baja primero
\ir ../../../rollback/mi_verificacion/99_down.sql   -- MI-VERIFICACION (155) se baja primero
\ir ../../../rollback/verificacion_vendedor/99_down.sql   -- VERIF-VENDEDOR (154) se baja primero
\ir ../../../rollback/invitaciones/99_down.sql   -- INVITACIONES (153) se baja primero
\ir ../../../rollback/cartera_clientes/99_down.sql   -- CARTERA-CLIENTES (152) se baja primero
\ir ../../../rollback/cx_enlace2/99_down.sql   -- CX-ENLACE-2 (151) se baja primero
\ir ../../../rollback/cx_enlace/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_prerregistros') is null and not exists (select 1 from pg_proc where proname in ('cc_visitante_prerregistrar', 'cc_puerta_chat', 'cc_contacto_de', '_cc_prerregistro_coincidencia')), '150 down · sin tabla ni comandos del prerregistro');
  perform tests.ok(md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = '4f79575dced5024a14cee0eec3d3d109' and md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) = 'd031a799c72205e532381a3f4a1ec200'
    and md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) = '1a761f28d2137357498534b0524e2039', '150 down · ruteo, nombre y cola idénticos a producción');
  perform tests.ok((select resto from _cx) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'admin_approve_doctor'
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias', 'cc_ruteo_pendientes', '_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores')), '150 down · ninguna otra función cambió (además de las que bajan 151 y 152)');
  perform tests.ok(md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) = '4389eb3daea9923e321b71a6ad199408' and to_regprocedure('public.cc_enlace_auto_asesor(uuid,text)') is null, '151 down · pendientes de Dirección idéntica a su versión anterior y sin auto-asesor');
  perform tests.ok((select n_p = (select count(*) from public.prospects) and n_v = (select count(*) from public.cc_visitors) from _cx), '150 down · sin cambios de datos');
  perform tests.ok((select proacl::text from pg_proc where oid = 'public._cc_rutear(uuid)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
    and has_function_privilege('authenticated', 'public.cc_cola_asesorias()', 'execute') and not has_function_privilege('anon', 'public.cc_cola_asesorias()', 'execute'), '150 down · permisos de las funciones restauradas intactos');
end $t$;
\ir ../../../migrations/20261203120000_cx_enlace_prerregistro.sql
\ir ../../../migrations/20261204120000_cx_enlace_auto_asesor.sql
\ir ../../../migrations/20261205120000_cartera_clientes.sql
\ir ../../../migrations/20261206120000_invitaciones_clientes.sql
\ir ../../../migrations/20261207120000_verificacion_vendedor.sql
\ir ../../../migrations/20261208120000_mi_verificacion.sql
\ir ../../../migrations/20261209120000_continuidad_aprobacion.sql
do $t$ begin
  perform tests.ok((select todas from _cx) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '150 + 151 · se vuelven a aplicar y quedan idénticas');
end $t$;
rollback;
