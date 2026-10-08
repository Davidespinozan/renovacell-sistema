-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HORARIO-P1 (migración 132) · «Guardar horario» fallaba SIEMPRE desde la app
--   · Causa: cc_horario_guardar vaciaba la semana con `delete from public.cc_horario_semanal;` (sin WHERE). En
--     producción el rol de la API (authenticator) precarga la extensión safeupdate, que rechaza DELETE/UPDATE sin
--     WHERE ("DELETE requires a WHERE clause"); la transacción se revertía entera (sin escritura parcial) y la app
--     mostraba el mensaje genérico. Las pruebas de BD no lo veían: corren sin safeupdate.
--   · Corrección mínima: el MISMO cuerpo, con `where dia between 1 and 7` (ck_chs_dia garantiza que es toda la
--     tabla). Sin cambios de firma, permisos, RLS, datos ni de ninguna otra función.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_horario_guardar(text,jsonb)') is null then raise exception 'HORARIO-P1: requiere CC-7'; end if;
  if position('delete from public.cc_horario_semanal where dia between 1 and 7' in pg_get_functiondef('public.cc_horario_guardar(text,jsonb)'::regprocedure)) > 0 then
    raise exception 'HORARIO-P1: ya aplicada';
  end if;
  if position('delete from public.cc_horario_semanal;' in pg_get_functiondef('public.cc_horario_guardar(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'HORARIO-P1: cc_horario_guardar no es la versión auditada — revisar antes de aplicar';
  end if;
end $pre$;

create or replace function public.cc_horario_guardar(p_zona text, p_semana jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare x jsonb; v_dia int; v_ab time; v_ci time; v_abierto boolean; vistos int[] := '{}'; antes jsonb;
begin
  perform public._cc7_direccion();
  if p_zona is null or not exists (select 1 from pg_timezone_names where name = p_zona) then raise exception 'ZONA_INVALIDA' using errcode = 'check_violation'; end if;
  if p_semana is null or jsonb_typeof(p_semana) <> 'array' or jsonb_array_length(p_semana) <> 7 then raise exception 'SEMANA_INVALIDA: se esperan 7 días' using errcode = 'check_violation'; end if;
  select jsonb_build_object('zona', zona, 'configurado', configurado,
         'semana', (select jsonb_agg(jsonb_build_object('dia', dia, 'abierto', abierto, 'abre', abre, 'cierra', cierra) order by dia) from public.cc_horario_semanal))
    into antes from public.cc_horario_config where id = 1 for update;
  delete from public.cc_horario_semanal where dia between 1 and 7;   -- HORARIO-P1 · con WHERE: safeupdate (rol authenticator) rechaza DELETE sin WHERE; ck_chs_dia garantiza 1..7 = toda la tabla
  for x in select * from jsonb_array_elements(p_semana) loop
    begin
      v_dia := (x ->> 'dia')::int; v_abierto := coalesce((x ->> 'abierto')::boolean, false);
      v_ab := case when v_abierto then (x ->> 'abre')::time end; v_ci := case when v_abierto then (x ->> 'cierra')::time end;
    exception when others then raise exception 'HORARIO_INVALIDO' using errcode = 'check_violation';
    end;
    if v_dia is null or v_dia not between 1 and 7 or v_dia = any (vistos) then raise exception 'SEMANA_INVALIDA: días repetidos o fuera de rango' using errcode = 'check_violation'; end if;
    if v_abierto and (v_ab is null or v_ci is null or v_ab >= v_ci) then raise exception 'HORARIO_INVALIDO: la apertura debe ser antes del cierre' using errcode = 'check_violation'; end if;
    vistos := vistos || v_dia;
    insert into public.cc_horario_semanal (dia, abierto, abre, cierra) values (v_dia, v_abierto, v_ab, v_ci);
  end loop;
  update public.cc_horario_config set zona = p_zona, configurado = true, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.cc_horario_eventos (accion, detalle, actor_profile_id) values ('semana_guardada', jsonb_build_object('antes', antes, 'despues', jsonb_build_object('zona', p_zona, 'semana', p_semana)), auth.uid());
  return public.cc_horario_ver();
end;
$$;

