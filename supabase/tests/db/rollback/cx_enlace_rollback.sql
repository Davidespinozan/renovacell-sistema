-- CX-ENLACE (150) · el down retira el prerregistro y devuelve el ruteo, el nombre y la cola exactamente a su versión
-- anterior; todo lo demás queda igual, y la migración se puede volver a aplicar.
begin;
create temp table _cx as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias', '_cc_prerregistro_coincidencia', 'cc_visitante_prerregistrar', 'cc_puerta_chat', 'cc_contacto_de', 'cc_enlace_auto_asesor', 'cc_ruteo_pendientes', '_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores', '_cartera_cliente_al_ligar', 'cliente_vendedor_asignar', 'cliente_estado_guardar',
         'cc_atencion_evaluar', '_cc_atencion', 'cc_atencion_config_ver', 'cc_iniciar_asesoria', 'cc_ruteo_resumen', '_cc_reparto_elegir', '_cc_reparto_asignar', 'cc_atencion_reparto_guardar') and p.proname not like 'cliente_invitacion_%' and p.proname not in ('_puede_verificar', 'doctor_verificacion_ver', 'doctor_verificar', 'doctor_verificacion_de_conversacion', 'cc_contacto_de') and p.proname <> 'mi_verificacion' and p.proname not in ('_ligar_prerregistro', 'admin_approve_doctor') and p.proname <> 'cc_prerregistro_datos' and p.proname not in ('_cc_wa_perfil', '_cc_wa_a_cola', 'cc_wa_entrante', '_cc_wa_contacto_de', '_cc_wa_encolar', 'cc_wa_salida_reclamar', 'cc_wa_salida_resolver', 'cc_wa_estado', 'cc_wa_conversacion', '_whatsapp_despachar', 'cc_wa_bandeja', '_cc_canal_a_cola', '_cc_meta_contacto_de', 'cc_meta_entrante', 'cc_meta_nombre', '_cc_meta_encolar', 'cc_meta_salida_reclamar', 'cc_meta_salida_resolver', 'cc_canal_conversacion', 'cc_canales_bandeja', '_cc_client_id_canal')) resto,
  (select count(*) from public.prospects) n_p, (select count(*) from public.cc_visitors) n_v;
\ir ../../../rollback/whatsapp_wamid_largo/99_down.sql   -- META-04 (188) redefine cc_wa_entrante/cc_meta_entrante: se baja primero
\ir ../../../rollback/reparto_asesores/99_down.sql   -- REPARTO (181) se baja primero (redefine _cc_rutear/evaluador/_cc_atencion/config_ver/iniciar/resumen)
\ir ../../../rollback/meta_canales/99_down.sql   -- META-CANALES (170) se baja antes (usa cc_visitors/cc_messages y cambia _cc_nombre_dueno)
\ir ../../../rollback/whatsapp_bandeja/99_down.sql   -- WHATSAPP-BANDEJA (169) se baja antes que la 168
\ir ../../../rollback/whatsapp_salida/99_down.sql   -- WHATSAPP-SALIDA (168) se baja antes que la 167
\ir ../../../rollback/whatsapp_canal/99_down.sql   -- WHATSAPP (167) se baja primero (cc_wa_mensajes depende de cc_messages; _cc_nombre_dueno)
\ir ../../../rollback/verificarme_en_chat/99_down.sql   -- VERIFICARME (159) se baja primero (lee cc_prerregistros)
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
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias', 'cc_ruteo_pendientes', '_c360_actor', 'cc_mi_cartera', 'cliente_360', 'cc_vendedores',
         'cc_atencion_evaluar', '_cc_atencion', 'cc_atencion_config_ver', 'cc_iniciar_asesoria', 'cc_ruteo_resumen', '_cc_reparto_elegir', '_cc_reparto_asignar', 'cc_atencion_reparto_guardar')), '150 down · ninguna otra función cambió (además de las que bajan 151, 152 y 181)');
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
\ir ../../../migrations/20261212120000_verificarme_en_chat.sql
\ir ../../../migrations/20261220120000_whatsapp_canal.sql
\ir ../../../migrations/20261221120000_whatsapp_salida.sql
\ir ../../../migrations/20261222120000_whatsapp_bandeja.sql
\ir ../../../migrations/20261223120000_meta_canales.sql
\ir ../../../migrations/20270103120000_reparto_asesores.sql
\ir ../../../migrations/20270110120000_whatsapp_wamid_largo.sql
\ir ../../../migrations/20270117120000_wa_identidad_fail_closed.sql   -- R4-B1: tras reaplicar la 167, el parche de identidad (si no, vuelve la liga por teléfono)
do $t$ begin
  perform tests.ok((select todas from _cx) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '150 + 151 · se vuelven a aplicar y quedan idénticas');
end $t$;
rollback;
