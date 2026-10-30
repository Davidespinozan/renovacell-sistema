-- CARTERA-CLIENTES (152) · el down retira la cartera por cliente y devuelve las funciones exactamente a su versión
-- anterior; todo lo demás queda igual, y la migración se puede volver a aplicar.
begin;
\ir ../../../rollback/reparto_verificacion/99_down.sql   -- REPARTO-VERIF (20270213) redefine funciones de esta cadena: se baja antes de la foto inicial
\ir ../../../rollback/internas_solo_si_mismas/99_down.sql   -- INTERNAS-2 se baja antes (redefine políticas, cc_vendedores y comisiones_equipo)
\ir ../../../rollback/comisiones_jefe/99_down.sql   -- COMISIONES-JEFE usa _es_interna: se baja primero
\ir ../../../rollback/cuentas_internas/99_down.sql   -- CUENTAS INTERNAS se baja antes de tomar la foto (redefine reparto, cc_vendedores y conteos)
create temp table _ck as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cc_prerregistro_coincidencia', '_cartera_cliente_al_ligar', 'cliente_vendedor_asignar', 'cliente_estado_guardar') and p.proname not like 'cliente_invitacion_%' and p.proname not in ('_puede_verificar', 'doctor_verificacion_ver', 'doctor_verificar', 'doctor_verificacion_de_conversacion', 'cc_contacto_de') and p.proname <> 'mi_verificacion' and p.proname not in ('_ligar_prerregistro', 'admin_approve_doctor')) resto,
  (select count(*) from public.customers) n_c, (select count(*) from public.cc_cartera) n_k;
\ir ../../../rollback/continuidad/99_down.sql   -- CONTINUIDAD (156) se baja primero
\ir ../../../rollback/mi_verificacion/99_down.sql   -- MI-VERIFICACION (155) se baja primero
\ir ../../../rollback/verificacion_vendedor/99_down.sql   -- VERIF-VENDEDOR (154) se baja primero
\ir ../../../rollback/invitaciones/99_down.sql   -- INVITACIONES (153) se baja primero
\ir ../../../rollback/cartera_clientes/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_cartera_clientes') is null and to_regclass('public.cc_cartera_clientes_historial') is null
    and not exists (select 1 from pg_proc where proname in ('cliente_vendedor_asignar', 'cliente_estado_guardar', '_cartera_cliente_al_ligar'))
    and not exists (select 1 from pg_trigger where tgname = 'trg_customers_cartera_al_ligar'), '152 down · sin tablas, comandos ni trigger');
  perform tests.ok(md5(pg_get_functiondef('public._c360_actor(uuid)'::regprocedure)) = '4952be3c8cc4c75ba0bc2fe0e914db70' and md5(pg_get_functiondef('public.cliente_360(uuid)'::regprocedure)) = '4d09fcfda9cbe2ac5cc261eb9871c53a'
    and md5(pg_get_functiondef('public.cc_mi_cartera()'::regprocedure)) = 'a02c498626e4454e236f4b6633502a41' and md5(pg_get_functiondef('public.cc_vendedores()'::regprocedure)) = 'cf9f22c438205f05d07ed450dd8ee009'
    and md5(pg_get_functiondef('public._cc_prerregistro_coincidencia(text,text)'::regprocedure)) = '0bcee140991db42178db2b6e6547371a', '152 down · funciones idénticas a producción');
  perform tests.ok((select resto from _ck) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'admin_approve_doctor'
     and p.proname not in ('_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cc_prerregistro_coincidencia', 'cc_contacto_de')), '152 down · ninguna otra función cambió');
  perform tests.ok((select n_c = (select count(*) from public.customers) and n_k = (select count(*) from public.cc_cartera) from _ck), '152 down · sin cambios de datos');
end $t$;
\ir ../../../migrations/20261205120000_cartera_clientes.sql
\ir ../../../migrations/20261206120000_invitaciones_clientes.sql
\ir ../../../migrations/20261207120000_verificacion_vendedor.sql
\ir ../../../migrations/20261208120000_mi_verificacion.sql
\ir ../../../migrations/20261209120000_continuidad_aprobacion.sql
do $t$ begin
  perform tests.ok((select todas from _ck) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '152 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
