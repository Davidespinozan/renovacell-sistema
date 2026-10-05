-- W6-A1 · El rollback ABORTA si hay suspendidos (bajarlo los reactivaría) y, sin
-- suspendidos, devuelve auth_role/has_cap/is_verified a su texto anterior sin tocar datos.
begin;
savepoint antes;
do $t$
declare v_wh uuid := tests.user('warehouse');
begin
  perform tests.suspender(v_wh, 'x');
  begin
    if (select count(*) from public.profiles where not active) > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay cuentas suspendidas';
    end if;
    perform tests.ok(false, 'el rollback debía abortar');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%', 'con cuentas suspendidas el rollback ABORTA (bajarlo las reactivaría)');
  end;
end $t$;
rollback to savepoint antes;

do $t$
begin
  create temp table w6a_antes on commit drop as
    select (select count(*) from public.profiles) as perfiles, (select count(*) from auth.users) as usuarios,
           (select count(*) from public.audit_logs) as bitacora;
end $t$;

\ir ../../../rollback/w6a/99_down.sql

do $t$
declare a record; v_wh uuid; v_adm uuid;
begin
  select * into a from w6a_antes;
  perform tests.ok(a.perfiles = (select count(*) from public.profiles) and a.usuarios = (select count(*) from auth.users)
               and a.bitacora = (select count(*) from public.audit_logs), 'ningún dato cambió');
  v_wh := tests.user('warehouse'); v_adm := tests.user('admin');
  perform tests.ok(to_regproc('public.suspender_staff') is null and to_regproc('public.reactivar_staff') is null
               and to_regproc('public._cuenta_suspendida') is null and position('active' in pg_get_functiondef('public.profiles_guard()'::regprocedure)) = 0,
    'comandos y fallo cerrado desaparecieron; la guarda volvió a su texto anterior');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'active'), 'la columna active desapareció');
  perform tests.ok(position('_cuenta_suspendida' in pg_get_functiondef('public.auth_role()'::regprocedure)) = 0
               and position('active' in pg_get_functiondef('public.has_cap(text)'::regprocedure)) = 0,
    'auth_role / has_cap volvieron a su texto anterior');
  perform tests.act_as(v_wh);
  perform tests.eq(public.auth_role(), 'warehouse', 'el personal sigue operando tras bajar W6-A1');
  perform tests.act_as(v_adm);
  perform tests.ok(public.kpi_ventas() ? 'ventas', 'W5 sigue en pie');
end $t$;
rollback;
