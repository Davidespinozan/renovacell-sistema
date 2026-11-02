-- AVISO RUIDOSO (20270305) · el down retira disparadores y funciones; se reaplica idéntica.
begin;
\ir ../../../rollback/link_pago/99_down.sql   -- LINK DE PAGO (20270309) redefine el push de avisos y usa helpers de pedido por WhatsApp: se baja antes
\ir ../../../rollback/adopcion_portal/99_down.sql   -- ADOPCIÓN (20270308) redefine el cierre de la verificación y la confirmación por WhatsApp: se baja antes de la foto inicial
\ir ../../../rollback/pedido_wa/99_down.sql   -- PEDIDO-WA (20270307) redefine el disparador de alertas y cuelga de la identidad del canal: se baja antes de la foto inicial
\ir ../../../rollback/verificacion_wa/99_down.sql   -- VERIFICACIÓN-WA (20270306) redefine la carga del push de alertas: se baja antes de la foto inicial
create temp table _av as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/aviso_ruidoso/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_trigger where tgname in ('cc_aviso_push', 'trg_ccm_zzescribe')) and to_regprocedure('public.aviso_push_carga(uuid)') is null, 'AVISO-RUIDOSO down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270305120000_aviso_ruidoso.sql
do $t$ begin
  perform tests.ok((select todas from _av) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'AVISO-RUIDOSO · se reaplica idéntica');
end $t$;
rollback;
