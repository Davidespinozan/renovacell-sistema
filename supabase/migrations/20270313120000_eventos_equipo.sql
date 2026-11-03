-- ============================================================================
-- EVENTOS CON EQUIPO (2 nov 2026). Dueño: "en los eventos el único capacitado de crear el evento es Alberto y ya él
-- elegirá a quién lleva al evento y quiénes ven el punto de venta y todo lo relacionado al evento" + "que Dirección
-- tenga acceso... Dirección tiene que poder ver".
--   · Crear un EVENTO: solo Almacén (Alberto). Las custodias de vendedor siguen igual (Dirección o Almacén).
--   · Equipo del evento (cc: custody_members): Alberto elige responsable y personas; agrega o quita mientras esté abierto.
--   · Punto de venta del evento: solo su equipo (de cualquier puesto) y Dirección; el auxiliar de almacén ya no ve todos
--     los eventos (solo los suyos). Dirección, Facturación y Almacén ven todo.
--   · Cerrar y liquidar: Dirección o Almacén.
-- ============================================================================
create table if not exists public.custody_members (
  custody_id uuid not null references public.custodies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid, added_at timestamptz not null default now(),
  primary key (custody_id, profile_id)
);
alter table public.custody_members enable row level security;
revoke all on public.custody_members from public, anon, authenticated;
drop policy if exists custody_members_select on public.custody_members;
create policy custody_members_select on public.custody_members for select to authenticated
  using (public.auth_role() = any (array['admin', 'billing', 'warehouse']) or profile_id = auth.uid());
grant select on public.custody_members to authenticated;

-- ¿Esta persona es del equipo del evento? (el responsable siempre lo es)
create or replace function public._evento_es_miembro(p_custody uuid, p_uid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select p_uid is not null and exists (select 1 from public.custodies c where c.id = p_custody and c.status = 'abierta' and c.kind = 'evento'
        and (c.holder_user_id = p_uid or exists (select 1 from public.custody_members m where m.custody_id = c.id and m.profile_id = p_uid)))
        and exists (select 1 from public.profiles p where p.id = p_uid and p.active and p.role_id <> 'doctor') $$;   -- solo EVENTOS y solo personal

-- Alberto arma el equipo: responsable (titular) + personas. Reemplaza la lista; el responsable siempre queda.
create or replace function public.evento_equipo_guardar(p_custody uuid, p_miembros uuid[]) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c public.custodies; n int;
begin
  if public.auth_role() <> 'warehouse' then raise exception 'NO_AUTORIZADO: solo Almacén arma el equipo del evento' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.custodies where id = p_custody for update;
  if not found or c.kind <> 'evento' then raise exception 'EVENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if c.status <> 'abierta' then raise exception 'EVENTO_CERRADO: el evento ya se cerró' using errcode = 'check_violation'; end if;
  if exists (select 1 from unnest(coalesce(p_miembros, '{}')) u where not exists (select 1 from public.profiles p where p.id = u and p.active and p.role_id <> 'doctor')) then
    raise exception 'MIEMBRO_INVALIDO: solo personal activo va a un evento' using errcode = 'check_violation';
  end if;
  delete from public.custody_members where custody_id = p_custody and not (profile_id = any (coalesce(p_miembros, '{}')));
  insert into public.custody_members (custody_id, profile_id, added_by)
  select p_custody, u, auth.uid() from unnest(coalesce(p_miembros, '{}') || c.holder_user_id) u where u is not null on conflict do nothing;
  select count(*) into n from public.custody_members where custody_id = p_custody;
  return jsonb_build_object('custody_id', p_custody, 'miembros', n);
end;
$$;

-- Lo que la persona ve de eventos: Dirección/Facturación/Almacén todo; los demás, los eventos de los que es parte.
drop policy if exists custodies_select_ops on public.custodies;
create policy custodies_select_ops on public.custodies for select to authenticated
  using (public.auth_role() = any (array['admin', 'billing', 'warehouse']) or (public.auth_role() = 'packing' and kind <> 'evento')
         or holder_user_id = auth.uid() or exists (select 1 from public.custody_members m where m.custody_id = custodies.id and m.profile_id = auth.uid()));
drop policy if exists custody_lines_select_ops on public.custody_lines;
create policy custody_lines_select_ops on public.custody_lines for select to authenticated
  using (public.auth_role() = any (array['admin', 'billing', 'warehouse'])
         or exists (select 1 from public.custodies c where c.id = custody_lines.custody_id
                    and ((public.auth_role() = 'packing' and c.kind <> 'evento') or c.holder_user_id = auth.uid()
                         or exists (select 1 from public.custody_members m where m.custody_id = c.id and m.profile_id = auth.uid()))));

do $d$
declare v text := pg_get_functiondef('public.abrir_custodia(uuid,text,text,uuid,uuid,text,text,date)'::regprocedure);
begin
  if position('if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén abren una custodia'';' in v) = 0 then raise exception 'EVENTOS_EQUIPO: abrir_custodia cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén abren una custodia'';', 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) or (p_kind = ''evento'' and public.auth_role() <> ''warehouse'') then
    raise exception ''NO_AUTORIZADO: solo Almacén abre eventos; Dirección o Almacén abren una custodia de vendedor'';');
end $d$;
do $d$
declare v text := pg_get_functiondef('public.cerrar_custodia(uuid,uuid,text)'::regprocedure);
begin
  if position('if public.auth_role() <> ''admin'' then
    raise exception ''NO_AUTORIZADO: solo Dirección cierra y liquida una custodia'';' in v) = 0 then raise exception 'EVENTOS_EQUIPO: cerrar_custodia cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if public.auth_role() <> ''admin'' then
    raise exception ''NO_AUTORIZADO: solo Dirección cierra y liquida una custodia'';', 'if not (public.auth_role() = any (array[''admin'',''warehouse''])) then
    raise exception ''NO_AUTORIZADO: solo Dirección o Almacén cierran y liquidan una custodia'';');
end $d$;
do $d$
declare v text := pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure);
begin
  if position('if not (v_global or coalesce(v_c.holder_user_id = auth.uid(), false)) then' in v) = 0 then raise exception 'EVENTOS_EQUIPO: estado_custodia cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if not (v_global or coalesce(v_c.holder_user_id = auth.uid(), false)) then', 'if not ((v_global and not (public.auth_role() = ''packing'' and v_c.kind = ''evento'')) or coalesce(v_c.holder_user_id = auth.uid(), false) or public._evento_es_miembro(v_c.id, auth.uid())) then');
end $d$;
do $d$
declare v text := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
begin
  if position('if not (public.auth_role() = any (array[''admin'',''pos''])) then
    raise exception ''No autorizado'';' in v) = 0 then raise exception 'EVENTOS_EQUIPO: vender_pos cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if not (public.auth_role() = any (array[''admin'',''pos''])) then
    raise exception ''No autorizado'';', 'if not (public.auth_role() = any (array[''admin'',''pos'']) or (p_custody_id is not null and public._evento_es_miembro(p_custody_id, auth.uid()))) then
    raise exception ''No autorizado'';');
end $d$;
do $d$
declare v text := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
begin
  if position('if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false)) then
      raise exception ''NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella'';' in v) = 0 then raise exception 'EVENTOS_EQUIPO: vender_pos cambió; revisar antes de aplicar'; end if;
  execute replace(v, 'if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false)) then
      raise exception ''NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella'';', 'if not (public.auth_role() = ''admin'' or coalesce(v_cus.holder_user_id = v_uid, false) or public._evento_es_miembro(v_cus.id, v_uid)) then
      raise exception ''NO_AUTORIZADO: solo el equipo del evento (o Dirección) vende de esa custodia'';');
end $d$;

do $g$ begin
  execute 'revoke all on function public._evento_es_miembro(uuid, uuid), public.evento_equipo_guardar(uuid, uuid[]) from public, anon';
  execute 'grant execute on function public._evento_es_miembro(uuid, uuid), public.evento_equipo_guardar(uuid, uuid[]) to authenticated';
end $g$;
