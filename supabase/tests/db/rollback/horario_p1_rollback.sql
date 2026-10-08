-- HORARIO-P1 (132) · el down restaura el cuerpo exacto de CC-7 y no toca datos.
begin;
create temp table _hp1 as select (select count(*) from public.cc_horario_semanal) s, (select count(*) from public.cc_horario_eventos) e;
\ir ../../../rollback/horario_p1/99_down.sql
do $t$
begin
  perform tests.ok(position('delete from public.cc_horario_semanal;' in pg_get_functiondef('public.cc_horario_guardar(text,jsonb)'::regprocedure)) > 0, '132 down · cuerpo de CC-7 restaurado');
  perform tests.ok((select s = (select count(*) from public.cc_horario_semanal) and e = (select count(*) from public.cc_horario_eventos) from _hp1), '132 down · sin cambios de datos');
end $t$;
rollback;
