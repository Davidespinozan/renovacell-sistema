-- CC-1 · El rollback retira el dominio de visitante y devuelve el dedupe a CC-0B.
begin;
-- Rollback EN CAPAS (como W1/W2): CC-3 reutiliza _cc_append_only y CC-2 se apoya en cc_visitors
-- (FK restrict), así que bajan primero, en orden inverso.
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/whatsapp_bandeja/99_down.sql   -- WHATSAPP-BANDEJA (169) se baja antes que la 168
\ir ../../../rollback/whatsapp_salida/99_down.sql   -- WHATSAPP-SALIDA (168) se baja antes que la 167
\ir ../../../rollback/whatsapp_canal/99_down.sql   -- WHATSAPP (167) se baja primero (depende de cc_visitors y cc_messages)
\ir ../../../rollback/chat_pro/99_down.sql   -- CHAT PRO (161) se baja primero (columna en cc_participants)
\ir ../../../rollback/avisos_push/99_down.sql   -- AVISOS (160) se baja primero (depende de cc_visitors)
\ir ../../../rollback/chat_adjuntos/99_down.sql   -- FOTOS (157) se baja primero (cc_adjuntos depende de cc_messages)
\ir ../../../rollback/continuidad/99_down.sql   -- CONTINUIDAD (156) se baja primero
\ir ../../../rollback/mi_verificacion/99_down.sql   -- MI-VERIFICACION (155) se baja primero
\ir ../../../rollback/verificacion_vendedor/99_down.sql   -- VERIF-VENDEDOR (154) se baja primero
\ir ../../../rollback/invitaciones/99_down.sql   -- INVITACIONES (153) se baja primero
\ir ../../../rollback/cartera_clientes/99_down.sql   -- CARTERA-CLIENTES (152) se baja primero
\ir ../../../rollback/cx_enlace2/99_down.sql   -- CX-ENLACE-2 (151) se baja primero
\ir ../../../rollback/cx_enlace/99_down.sql   -- CX-ENLACE (150) se baja primero (su tabla depende de cc_visitors)
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql   -- CHV2-A cron fix (124) se baja primero
\ir ../../../rollback/chv2a/99_down.sql   -- CHV2-A (123) se baja primero
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql   -- CC-7 se baja primero (depende de CC-2/5/6)
\ir ../../../rollback/cc6/99_down.sql
\ir ../../../rollback/cc5/99_down.sql
\ir ../../../rollback/cc4/99_down.sql
\ir ../../../rollback/cc3/99_down.sql
\ir ../../../rollback/cc2/99_down.sql
\ir ../../../rollback/cc1/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_visitors') is null and to_regclass('public.cc_visitor_events') is null and to_regclass('public.cc_referral_codes') is null, 'tablas cc_* retiradas');
  perform tests.ok(to_regprocedure('public.cc_visitante_adoptar(text,uuid)') is null and to_regprocedure('public.cc_visitante_abrir(text,text,jsonb,text)') is null
               and to_regprocedure('public.norm_telefono_mx(text)') is null, 'funciones CC-1 retiradas');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospects' and column_name = 'visitor_id'), 'prospects.visitor_id retirada');
  perform tests.ok(exists (select 1 from pg_indexes where indexname = 'idx_prospects_phone_digits') and not exists (select 1 from pg_indexes where indexname = 'idx_prospects_phone_norm'), 'índice de dedupe CC-0B restaurado');
  perform tests.ok(pg_get_functiondef('public.buscar_prospecto_duplicado(text,text)'::regprocedure) like '%>= 7%' and pg_get_functiondef('public.buscar_prospecto_duplicado(text,text)'::regprocedure) not like '%norm_telefono_mx%', 'dedupe vuelve a la regla CC-0B');
  perform tests.ok(has_function_privilege('service_role', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE'), 'privilegios del dedupe iguales a CC-0B');
end $t$;
rollback;
