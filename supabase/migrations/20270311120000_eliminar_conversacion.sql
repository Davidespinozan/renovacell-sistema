-- ============================================================================
-- ELIMINAR CONVERSACIÓN (2 nov 2026, dueño: "ahorita debería existir manera de poder eliminar chats").
-- Solo Dirección, con motivo. Se borra la conversación y TODO lo que cuelga de ella (mensajes, sesiones, turnos de la
-- IA, mensajes de WhatsApp/Meta, colas de salida, avisos…). Con "olvidar contacto" (pruebas/spam) también el contacto de
-- WhatsApp/Meta y su visitante: si vuelve a escribir, entra como nuevo.
-- Antes de borrar, cada fila se copia a cc_purga_archivo (sin acceso desde la app) y queda una constancia en
-- cc_eliminaciones (quién, cuándo, por qué y cuánto). Lo que solo REFERENCIA la conversación (carritos del cliente,
-- cotizaciones) se conserva con la referencia en blanco.
-- ============================================================================
create table if not exists public.cc_eliminaciones (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  motivo text not null check (length(btrim(motivo)) >= 3),
  olvidar_contacto boolean not null default false,
  contacto text,
  eliminado_por uuid not null,
  eliminado_at timestamptz not null default now(),
  resumen jsonb not null default '{}'::jsonb
);
create table if not exists public.cc_purga_archivo (
  id bigserial primary key,
  eliminacion_id uuid not null references public.cc_eliminaciones(id),
  tabla text not null,
  fila jsonb not null,
  archivado_at timestamptz not null default now()
);
alter table public.cc_eliminaciones enable row level security;
alter table public.cc_purga_archivo enable row level security;
revoke all on public.cc_eliminaciones, public.cc_purga_archivo from public, anon, authenticated;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'cc_eliminaciones' and policyname = 'cc_eliminaciones_direccion') then
    create policy cc_eliminaciones_direccion on public.cc_eliminaciones for select to authenticated using (public.auth_role() = 'admin');
  end if;
end $p$;
grant select on public.cc_eliminaciones to authenticated;

-- Borrado recursivo con archivo, solo HACIA ABAJO (lo que referencia a la fila): nunca sube a clientes, cuentas ni
-- pedidos. Las referencias "suaves" (on delete set null) se dejan en blanco; si la fila no admite quedar en blanco,
-- depende de lo borrado y se borra también. Autorreferencias y ciclos no se reabren en su propia rama.
create or replace function public._cc_purgar_rama(p_elim uuid, p_tabla regclass, p_cond text, p_ruta regclass[] default '{}') returns void
  language plpgsql security definer set search_path = public as
$$
declare fk record; v_sub text; v_blanco boolean;
begin
  for fk in
    select c.conrelid::regclass t, a.attname col, af.attname refcol, c.confdeltype del
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = p_tabla and array_length(c.conkey, 1) = 1
  loop
    v_sub := format('%I in (select %I from %s where %s)', fk.col, fk.refcol, p_tabla, p_cond);
    if fk.t = p_tabla or fk.t = any (p_ruta) then continue; end if;
    -- Se conserva con la referencia en blanco: lo que es del cliente o de un pedido, no de la conversación.
    v_blanco := (fk.del = 'n' or (fk.t, fk.col) in (('public.cc_carts'::regclass, 'conversation_id'::name), ('public.cc_carts'::regclass, 'handoff_conversation_id'::name),
                                                  ('public.cc_carts'::regclass, 'handoff_session_id'::name), ('public.cotizaciones'::regclass, 'conversation_id'::name)))
                and not (fk.t = 'public.notifications'::regclass and fk.col = 'conversation_id');
    if v_blanco then
      begin
        execute format('update %s set %I = null where %s', fk.t, fk.col, v_sub);
      exception when check_violation or not_null_violation then
        perform public._cc_purgar_rama(p_elim, fk.t, v_sub, p_ruta || p_tabla);
      end;
    else
      perform public._cc_purgar_rama(p_elim, fk.t, v_sub, p_ruta || p_tabla);
    end if;
  end loop;
  execute format('insert into public.cc_purga_archivo (eliminacion_id, tabla, fila) select %L, %L, to_jsonb(t) from %s t where %s', p_elim, p_tabla::text, p_tabla, p_cond);
  execute format('delete from %s where %s', p_tabla, p_cond);
end;
$$;

create or replace function public.cc_conversacion_eliminar(p_conv uuid, p_motivo text, p_olvidar_contacto boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c public.cc_conversations; v_elim uuid; v_vis uuid; v_contacto text; v_resumen jsonb;
        v_t text := coalesce(current_setting('app.trusted', true), ''); v_p text := coalesce(current_setting('renovacell.purge', true), ''); v_c text := coalesce(current_setting('app.cc_purga', true), '');
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección elimina conversaciones' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'MOTIVO_REQUERIDO: escribe por qué se elimina' using errcode = 'check_violation'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'CONVERSACION_INEXISTENTE' using errcode = 'check_violation'; end if;
  v_vis := c.visitor_id;
  v_contacto := coalesce((select 'WhatsApp …' || right(w.wa_id, 4) || coalesce(' · ' || w.nombre, '') from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id limit 1),
                         (select m.canal || coalesce(' · ' || m.nombre, '') from public.cc_meta_contactos m where c.visitor_id is not null and m.visitor_id = c.visitor_id limit 1),
                         public._cc_nombre_dueno(p_conv));
  insert into public.cc_eliminaciones (conversation_id, motivo, olvidar_contacto, contacto, eliminado_por)
  values (p_conv, left(btrim(p_motivo), 300), coalesce(p_olvidar_contacto, false), left(v_contacto, 200), auth.uid()) returning id into v_elim;

  perform set_config('app.trusted', 'on', true), set_config('renovacell.purge', 'on', true), set_config('app.cc_purga', 'on', true);
  perform public._cc_purgar_rama(v_elim, 'public.cc_conversations', format('id = %L', p_conv));
  -- Olvidar el contacto (pruebas/spam): su WhatsApp/Meta y su visitante interno, si ya no tiene otra conversación.
  if coalesce(p_olvidar_contacto, false) and v_vis is not null and not exists (select 1 from public.cc_conversations where visitor_id = v_vis) then
    perform public._cc_purgar_rama(v_elim, 'public.cc_wa_contactos', format('visitor_id = %L', v_vis));
    perform public._cc_purgar_rama(v_elim, 'public.cc_meta_contactos', format('visitor_id = %L', v_vis));
    if not exists (select 1 from public.cc_visitors where id = v_vis and adopted_profile_id is not null) then
      perform public._cc_purgar_rama(v_elim, 'public.cc_visitors', format('id = %L', v_vis));
    end if;
  end if;
  perform set_config('app.trusted', v_t, true), set_config('renovacell.purge', v_p, true), set_config('app.cc_purga', v_c, true);

  select coalesce(jsonb_object_agg(tabla, n), '{}'::jsonb) into v_resumen from (select tabla, count(*) n from public.cc_purga_archivo where eliminacion_id = v_elim group by tabla) x;
  update public.cc_eliminaciones set resumen = v_resumen where id = v_elim;
  return jsonb_build_object('eliminada', true, 'eliminacion_id', v_elim, 'contacto', v_contacto, 'resumen', v_resumen);
end;
$$;

do $g$ begin
  execute 'revoke all on function public._cc_purgar_rama(uuid, regclass, text, regclass[]), public.cc_conversacion_eliminar(uuid, text, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.cc_conversacion_eliminar(uuid, text, boolean) to authenticated';
end $g$;
