-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PLANTILLAS DESDE EL SISTEMA (14 nov 2026, dueño: "en Leadsales hacían plantillas y las mandaban a verificación; deberían
-- poder hacer eso desde adentro"). Sobre WA-PLANTILLAS (20270403):
--   · cc_wa_plantillas guarda el estado en Meta (sin_enviar / PENDING / APPROVED / REJECTED / PAUSED / DISABLED…), su id,
--     el motivo de rechazo y cuándo se mandó y se revisó. ACTIVA = APROBADA: la Edge `wa-plantillas` la enciende o apaga
--     según lo que diga Meta (el interruptor manual de Dirección sigue como respaldo).
--   · cc_wa_plantilla_guardar: Dirección crea o corrige una plantilla (solo si no se ha mandado o Meta la rechazó). El cuerpo
--     llega con {{1}}, {{2}}… y la lista de datos; la base revisa que cuadren.
--   · cc_wa_plantilla_borrar: Dirección borra una que nunca se usó y no está en Meta (o fue rechazada).
--   · cc_wa_plantillas_lista: + estado_meta, motivo_meta, enviada_at, revisada_at, usada.
-- La Edge escribe el estado con la llave de servicio (la tabla no se abre a authenticated).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_plantillas') is null then raise exception 'WA-PLANTILLAS-META: falta WA-PLANTILLAS (20270403)'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_wa_plantillas' and column_name = 'estado_meta') then
    raise exception 'WA-PLANTILLAS-META: ya aplicada'; end if;
end $pre$;

alter table public.cc_wa_plantillas
  add column estado_meta text not null default 'sin_enviar' check (estado_meta ~ '^[A-Za-z_]{3,40}$'),
  add column meta_id     text,
  add column motivo_meta text,
  add column enviada_at  timestamptz,
  add column revisada_at timestamptz,
  add column creada_por  uuid references public.profiles(id),
  add constraint ck_cc_wa_plantillas_botones check (coalesce(array_length(botones, 1), 0) <= 3),
  add constraint ck_cc_wa_plantillas_cuerpo check (char_length(cuerpo) between 10 and 1024);
comment on column public.cc_wa_plantillas.estado_meta is 'WA-PLANTILLAS-META · estado en Meta (sin_enviar = aún no se manda); activa = estado_meta APPROVED.';

drop function public.cc_wa_plantillas_lista();
create function public.cc_wa_plantillas_lista() returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or not public._cc_puede_atender(auth.uid()) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'etiqueta', p.etiqueta, 'categoria', p.categoria, 'cuerpo', p.cuerpo, 'variables', p.variables,
                     'botones', p.botones, 'activa', p.activa, 'estado_meta', p.estado_meta, 'motivo_meta', p.motivo_meta, 'enviada_at', p.enviada_at, 'revisada_at', p.revisada_at,
                     'usada', exists (select 1 from public.cc_wa_plantilla_envios e where e.plantilla = p.nombre)) order by p.activa desc, p.etiqueta)
                     from public.cc_wa_plantillas p where p.activa or public._cc_es_admin()), '[]'::jsonb);
end;
$$;

create function public.cc_wa_plantilla_guardar(p_nombre text, p_etiqueta text, p_categoria text, p_cuerpo text, p_variables text[], p_botones text[]) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare t public.cc_wa_plantillas; v_n int; i int;
begin
  if auth.uid() is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if coalesce(p_nombre, '') !~ '^[a-z0-9_]{3,60}$' then raise exception 'PLANTILLA_DATOS: el nombre solo lleva minúsculas, números y guion bajo' using errcode = 'check_violation'; end if;
  if char_length(btrim(coalesce(p_etiqueta, ''))) < 3 then raise exception 'PLANTILLA_DATOS: ponle un nombre' using errcode = 'check_violation'; end if;
  if p_categoria not in ('MARKETING', 'UTILITY') then raise exception 'PLANTILLA_DATOS: tipo inválido' using errcode = 'check_violation'; end if;
  if not (coalesce(p_variables, '{}') <@ array['cliente', 'vendedor', 'promocion', 'promocion_hasta']) then raise exception 'PLANTILLA_DATOS: dato desconocido' using errcode = 'check_violation'; end if;
  if 'promocion_hasta' = any (coalesce(p_variables, '{}')) and not ('promocion' = any (p_variables)) then
    raise exception 'PLANTILLA_DATOS: la fecha de fin va junto con el nombre de la promoción' using errcode = 'check_violation'; end if;
  -- {{1}}…{{n}} deben ser exactamente los datos declarados (Meta y el envío los numeran igual)
  v_n := coalesce(array_length(p_variables, 1), 0);
  for i in 1 .. v_n loop
    if position('{{' || i || '}}' in coalesce(p_cuerpo, '')) = 0 then raise exception 'PLANTILLA_DATOS: falta el dato {{%}} en el texto', i using errcode = 'check_violation'; end if;
  end loop;
  if position('{{' || (v_n + 1) || '}}' in coalesce(p_cuerpo, '')) > 0 then raise exception 'PLANTILLA_DATOS: el texto tiene más datos que los declarados' using errcode = 'check_violation'; end if;
  select * into t from public.cc_wa_plantillas where nombre = p_nombre for update;
  if found and t.estado_meta not in ('sin_enviar', 'REJECTED') then
    raise exception 'PLANTILLA_DATOS: ya está en Meta (%); para cambiarla crea otra con otro nombre', t.estado_meta using errcode = 'check_violation'; end if;
  insert into public.cc_wa_plantillas (nombre, etiqueta, categoria, cuerpo, variables, botones, activa, estado_meta, creada_por, updated_at, updated_by)
  values (p_nombre, btrim(p_etiqueta), p_categoria, p_cuerpo, coalesce(p_variables, '{}'), coalesce(p_botones, '{}'), false, 'sin_enviar', auth.uid(), now(), auth.uid())
  on conflict (nombre) do update set etiqueta = excluded.etiqueta, categoria = excluded.categoria, cuerpo = excluded.cuerpo, variables = excluded.variables,
    botones = excluded.botones, activa = false, estado_meta = 'sin_enviar', motivo_meta = null, meta_id = null, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('nombre', p_nombre, 'estado_meta', 'sin_enviar');
end;
$$;

create function public.cc_wa_plantilla_borrar(p_nombre text) returns jsonb language plpgsql security definer set search_path = public as
$$
declare t public.cc_wa_plantillas;
begin
  if auth.uid() is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  select * into t from public.cc_wa_plantillas where nombre = p_nombre for update;
  if not found then raise exception 'PLANTILLA_INEXISTENTE' using errcode = 'check_violation'; end if;
  if t.estado_meta not in ('sin_enviar', 'REJECTED') then raise exception 'PLANTILLA_DATOS: está en Meta; no se borra desde aquí' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.cc_wa_plantilla_envios e where e.plantilla = p_nombre) then raise exception 'PLANTILLA_DATOS: ya se usó con clientes; no se borra' using errcode = 'check_violation'; end if;
  delete from public.cc_wa_plantillas where nombre = p_nombre;
  return jsonb_build_object('nombre', p_nombre, 'borrada', true);
end;
$$;

revoke all on function public.cc_wa_plantillas_lista(), public.cc_wa_plantilla_guardar(text, text, text, text, text[], text[]), public.cc_wa_plantilla_borrar(text) from public, anon;
grant execute on function public.cc_wa_plantillas_lista(), public.cc_wa_plantilla_guardar(text, text, text, text, text[], text[]), public.cc_wa_plantilla_borrar(text) to authenticated;
grant select, update on public.cc_wa_plantillas to service_role;

do $post$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_wa_plantillas' and column_name = 'estado_meta')
     or to_regprocedure('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])') is null then
    raise exception 'WA-PLANTILLAS-META: no quedó aplicada'; end if;
end $post$;
