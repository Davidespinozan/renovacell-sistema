-- Reversa de 20270313120000_eventos_equipo.sql (definiciones de producción del 2 nov 2026).
do $d$
declare v text := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
begin
  if position('if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false) or public._evento_es_miembro(v_cus.id, v_uid)) then
      raise exception ''NO_AUTORIZADO: solo el equipo del evento (o Dirección) vende de esa custodia'';' in v) > 0 then execute replace(v, 'if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false) or public._evento_es_miembro(v_cus.id, v_uid)) then
      raise exception ''NO_AUTORIZADO: solo el equipo del evento (o Dirección) vende de esa custodia'';', 'if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false)) then
      raise exception ''NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella'';'); end if;
end $d$;
do $d$
declare v text := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
begin
  if position('if not (public.auth_role() = any (array[''admin'',''pos'']) or (p_custody_id is not null and public._evento_es_miembro(p_custody_id, auth.uid()))) then
    raise exception ''No autorizado'';' in v) > 0 then execute replace(v, 'if not (public.auth_role() = any (array[''admin'',''pos'']) or (p_custody_id is not null and public._evento_es_miembro(p_custody_id, auth.uid()))) then
    raise exception ''No autorizado'';', 'if not (public.auth_role() = any (array[''admin'',''pos''])) then
    raise exception ''No autorizado'';'); end if;
end $d$;
do $d$
declare v text := pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure);
begin
  if position('if not ((v_global and not (public.auth_role() = ''packing'' and v_c.kind = ''evento'')) or coalesce(v_c.holder_user_id = auth.uid(), false) or public._evento_es_miembro(v_c.id, auth.uid())) then' in v) > 0 then execute replace(v, 'if not ((v_global and not (public.auth_role() = ''packing'' and v_c.kind = ''evento'')) or coalesce(v_c.holder_user_id = auth.uid(), false) or public._evento_es_miembro(v_c.id, auth.uid())) then', 'if not (v_global or coalesce(v_c.holder_user_id = auth.uid(), false)) then'); end if;
end $d$;
do $d$
declare v text := pg_get_functiondef('public.cerrar_custodia(uuid,uuid,text)'::regprocedure);
begin
  if position('if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén cierran y liquidan una custodia'';' in v) > 0 then execute replace(v, 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén cierran y liquidan una custodia'';', 'if public.auth_role() <> ''admin'' then
    raise exception ''NO_AUTORIZADO: solo Dirección cierra y liquida una custodia'';'); end if;
end $d$;
do $d$
declare v text := pg_get_functiondef('public.abrir_custodia(uuid,text,text,uuid,uuid,text,text,date)'::regprocedure);
begin
  if position('if not (public.auth_role() = any (array[''admin'',''warehouse''])) or (p_kind = ''evento'' and public.auth_role() <> ''warehouse'') then
    raise exception ''NO_AUTORIZADO: solo Almacén abre eventos; Dirección o Almacén abren una custodia de vendedor'';' in v) > 0 then execute replace(v, 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) or (p_kind = ''evento'' and public.auth_role() <> ''warehouse'') then
    raise exception ''NO_AUTORIZADO: solo Almacén abre eventos; Dirección o Almacén abren una custodia de vendedor'';', 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén abren una custodia'';'); end if;
end $d$;
drop policy if exists custodies_select_ops on public.custodies;
create policy custodies_select_ops on public.custodies for select to authenticated
  using ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'warehouse'::text, 'packing'::text])) OR (holder_user_id = auth.uid()));
drop policy if exists custody_lines_select_ops on public.custody_lines;
create policy custody_lines_select_ops on public.custody_lines for select to authenticated
  using ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'warehouse'::text, 'packing'::text])) OR (EXISTS ( SELECT 1
   FROM custodies c
  WHERE ((c.id = custody_lines.custody_id) AND (c.holder_user_id = auth.uid())))));
drop function if exists public.evento_equipo_guardar(uuid, uuid[]);
drop function if exists public._evento_es_miembro(uuid, uuid);
drop table if exists public.custody_members;
