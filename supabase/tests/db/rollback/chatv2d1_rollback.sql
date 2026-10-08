-- CHAT V2-D1 (130) · el down restaura la autoridad de la 129 (sin saludo), retira la firma con producto, los
-- ayudantes y el CHECK de procedencia; no borra mensajes.
begin;
create temp table _d1_antes as select (select count(*) from public.cc_messages) m;
\ir ../../../rollback/cartera_p1/99_down.sql   -- CARTERA-P1 (131) se baja primero
\ir ../../../rollback/chatv2d1/99_down.sql
do $t$
begin
  perform tests.ok(to_regprocedure('public._cc_handoff_carrito(uuid,uuid)') is null and to_regprocedure('public._cc_saludo_comercial(uuid,uuid,uuid,boolean,bigint)') is null
                   and to_regprocedure('public._cc_texto_saludo(text,text,boolean,text)') is null, '130 down · funciones del saludo retiradas');
  perform tests.ok(position('_cc_saludo_comercial' in pg_get_functiondef('public._cc_handoff_carrito(uuid)'::regprocedure)) = 0
                   and position('_cc_episodio_vivo' in pg_get_functiondef('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)'::regprocedure)) > 0, '130 down · autoridad de CI-1 (129) restaurada');
  perform tests.ok(not exists (select 1 from pg_constraint where conname = 'ck_ccm_procedencia_ia'), '130 down · CHECK retirado');
  perform tests.ok((select m = (select count(*) from public.cc_messages) from _d1_antes), '130 down · sin cambios de datos');
end $t$;
rollback;
