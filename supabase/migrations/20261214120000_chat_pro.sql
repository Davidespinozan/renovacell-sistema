-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CHAT PRO (migración 161) · "ESCRIBIENDO…", RESPUESTAS RÁPIDAS Y UNIR LA CONVERSACIÓN DEL ENLACE A LA CUENTA
--   Pedido del dueño (15 oct 2026): que el chat se sienta como un mensajero profesional.
--   · cc_participants.escribiendo_hasta   NUEVA columna. Hasta cuándo un participante "está escribiendo" (unos
--                                          segundos); nunca guarda lo que escribe.
--   · cc_escribiendo                       NUEVA (servidor). Marca o apaga "escribiendo" con la MISMA autoridad que
--                                          leer la conversación (_cc_autoridad).
--   · cc_respuestas_rapidas                NUEVA tabla. Textos listos para el personal: los de la empresa (los edita
--                                          Dirección) y los propios de cada vendedor. Se leen con RLS; se escriben solo
--                                          con cc_respuesta_guardar / cc_respuesta_borrar.
--   · cc_enlace_candidatos / cc_enlace_unir  NUEVAS. Si el doctor se registró en OTRO dispositivo con otro correo, quien
--                                          lo atiende ve la conversación del enlace que coincide por correo o celular y
--                                          la une a su cuenta (con su historial). Lo decide una persona, no el sistema.
--   NO cambia: mensajes, permisos de lectura, verificación ni la continuidad automática por correo (156).
--   Aplicar en UNA transacción. Rollback: supabase/rollback/chat_pro/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_respuestas_rapidas') is not null then raise exception 'CHAT-PRO: ya aplicada'; end if;
  if to_regprocedure('public._cc_autoridad(uuid,text,uuid,uuid)') is null or to_regprocedure('public._puede_verificar(uuid)') is null
     or to_regprocedure('public.cc_visitante_adoptar(text,uuid)') is null then
    raise exception 'CHAT-PRO: faltan piezas previas (CC-2, 154)';
  end if;
end $pre$;

-- ── 1 · "Escribiendo…" ─────────────────────────────────────────────────────────────────────────────
alter table public.cc_participants add column escribiendo_hasta timestamptz;
comment on column public.cc_participants.escribiendo_hasta is 'CHAT PRO · hasta cuándo este participante está escribiendo (segundos). No guarda texto.';

create function public.cc_escribiendo(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_activo boolean) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  perform public._cc_participante(p_conv, p_actor_type, v_visitor, case when p_actor_type <> 'visitor' then p_profile end,
                                  case when p_actor_type = 'seller' then 'asesor' when p_actor_type = 'admin' then 'supervisor' else 'dueno' end);
  update public.cc_participants set escribiendo_hasta = case when coalesce(p_activo, false) then now() + interval '6 seconds' end
   where conversation_id = p_conv and coalesce(profile_id::text, visitor_id::text) = coalesce(case when p_actor_type <> 'visitor' then p_profile end::text, v_visitor::text);
end;
$$;
alter function public.cc_escribiendo(uuid, text, text, uuid, boolean) owner to postgres;
revoke all on function public.cc_escribiendo(uuid, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.cc_escribiendo(uuid, text, text, uuid, boolean) to service_role;

-- ── 2 · Respuestas rápidas ─────────────────────────────────────────────────────────────────────────
create table public.cc_respuestas_rapidas (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,   -- null = de la empresa (Dirección)
  titulo      text not null check (length(btrim(titulo)) between 2 and 40),
  texto       text not null check (length(btrim(texto)) between 2 and 1000),
  orden       integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.cc_respuestas_rapidas is 'CHAT PRO · textos listos para responder. profile_id null = de la empresa (los edita Dirección); con perfil = propios del vendedor. {nombre} se cambia por el nombre del cliente al usarla.';
create index ix_cc_rr_profile on public.cc_respuestas_rapidas (profile_id, orden);
alter table public.cc_respuestas_rapidas enable row level security;
revoke all on table public.cc_respuestas_rapidas from public, anon, authenticated;
grant select on table public.cc_respuestas_rapidas to authenticated;   -- escribir: solo por los comandos de abajo (regla CC: sin escritura directa)
grant select, insert, update, delete on table public.cc_respuestas_rapidas to service_role;
create policy cc_rr_ver on public.cc_respuestas_rapidas for select to authenticated
  using (public.auth_role() in ('admin', 'pos') and (profile_id is null or profile_id = auth.uid()));

create function public.cc_respuesta_guardar(p_id uuid, p_titulo text, p_texto text, p_empresa boolean) returns uuid
  language plpgsql security definer set search_path = public as
$$
-- Alta o edición. Propias: cualquier vendedor o Dirección. De la empresa (sin dueño): solo Dirección.
declare v_rol text := public.auth_role(); v_uid uuid := auth.uid(); r public.cc_respuestas_rapidas; v_id uuid;
  v_titulo text := btrim(coalesce(p_titulo, '')); v_texto text := btrim(coalesce(p_texto, ''));
begin
  if v_uid is null or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_titulo) not between 2 and 40 or length(v_texto) not between 2 and 1000 then raise exception 'DATOS_INVALIDOS: título de 2 a 40 y texto de 2 a 1000 caracteres' using errcode = 'check_violation'; end if;
  if p_id is null then
    if coalesce(p_empresa, false) and v_rol <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección guarda respuestas de la empresa' using errcode = 'insufficient_privilege'; end if;
    insert into public.cc_respuestas_rapidas (profile_id, titulo, texto) values (case when coalesce(p_empresa, false) then null else v_uid end, v_titulo, v_texto) returning id into v_id;
    return v_id;
  end if;
  select * into r from public.cc_respuestas_rapidas where id = p_id for update;
  if not found or not (r.profile_id is not distinct from v_uid or (r.profile_id is null and v_rol = 'admin')) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_respuestas_rapidas set titulo = v_titulo, texto = v_texto, updated_at = now() where id = p_id;
  return p_id;
end;
$$;

create function public.cc_respuesta_borrar(p_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); v_uid uuid := auth.uid(); r public.cc_respuestas_rapidas;
begin
  if v_uid is null or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.cc_respuestas_rapidas where id = p_id for update;
  if not found or not (r.profile_id is not distinct from v_uid or (r.profile_id is null and v_rol = 'admin')) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  delete from public.cc_respuestas_rapidas where id = p_id;
end;
$$;
alter function public.cc_respuesta_guardar(uuid, text, text, boolean) owner to postgres;
alter function public.cc_respuesta_borrar(uuid) owner to postgres;
revoke all on function public.cc_respuesta_guardar(uuid, text, text, boolean), public.cc_respuesta_borrar(uuid) from public, anon;
grant execute on function public.cc_respuesta_guardar(uuid, text, text, boolean), public.cc_respuesta_borrar(uuid) to authenticated, service_role;

insert into public.cc_respuestas_rapidas (profile_id, titulo, texto, orden) values
  (null, 'Saludo', 'Hola {nombre}, gracias por escribir a Renovacell. ¿En qué te puedo ayudar?', 10),
  (null, 'Verificación', 'Para ver precios y hacer pedidos necesitamos verificar tu cédula profesional. Toca «Verificar mi cuenta» arriba en este chat; toma un par de minutos.', 20),
  (null, 'Fotos del INE', '¿Me compartes por aquí una foto del frente y otra del reverso de tu INE? Con eso termino tu verificación.', 30),
  (null, 'Ya verificado', 'Listo {nombre}, tu cuenta ya está verificada: ya puedes ver precios y hacer tus pedidos.', 40),
  (null, 'Envío', 'Enviamos a todo México. En cuanto se genere tu guía te comparto el número para que le des seguimiento.', 50),
  (null, 'Un momento', 'Dame un momento, lo reviso y te confirmo.', 60),
  (null, 'Despedida', 'Gracias {nombre}, quedo al pendiente por aquí para lo que necesites.', 70);

-- ── 3 · Unir la conversación del enlace a una cuenta registrada en otro dispositivo ───────────────
create function public._tel10(p text) returns text language sql immutable set search_path = public as
$$ select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '') $$;
revoke all on function public._tel10(text) from public, anon;
grant execute on function public._tel10(text) to authenticated, service_role;

create function public.cc_enlace_candidatos(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- Conversaciones del enlace (sin cuenta) que coinciden con este doctor por correo o celular. Solo quien lo atiende.
declare v_email text; v_tel text;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  select lower(btrim(p.email)), public._tel10(coalesce(p.meta -> 'shipping' ->> 'phone', p.meta ->> 'phone', (select k.phone from public.customers k where k.profile_id = p.id limit 1)))
    into v_email, v_tel from public.profiles p where p.id = p_profile and p.role_id = 'doctor';
  if not found then raise exception 'DOCTOR_INEXISTENTE' using errcode = 'check_violation'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('visitor_id', v.id, 'nombre', r.nombre, 'telefono', r.telefono, 'email', r.email, 'creado', r.created_at,
             'coincide', case when r.email = v_email and r.telefono = v_tel then 'correo y celular' when r.email = v_email then 'correo' else 'celular' end,
             'mensajes', (select count(*) from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.visitor_id = v.id and c.profile_id is null and m.actor_type <> 'system'))
           order by r.created_at desc)
      from public.cc_prerregistros r join public.cc_visitors v on v.id = r.visitor_id
     where v.estado = 'activo' and (v.pending_profile_id is null or v.pending_profile_id = p_profile)
       and ((v_email is not null and r.email = v_email) or (v_tel is not null and r.telefono = v_tel))), '[]'::jsonb);
end;
$$;

create function public.cc_enlace_unir(p_profile uuid, p_visitor uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- Une la conversación del enlace a la cuenta del doctor. Solo una que coincida por correo o celular (cc_enlace_candidatos).
declare v_ok boolean;
begin
  if not public._puede_verificar(p_profile) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  select exists (select 1 from jsonb_array_elements(public.cc_enlace_candidatos(p_profile)) e where (e ->> 'visitor_id')::uuid = p_visitor) into v_ok;
  if not v_ok then raise exception 'NO_COINCIDE: esa conversación no coincide con este doctor' using errcode = 'check_violation'; end if;
  update public.cc_visitors set pending_profile_id = p_profile, pending_at = coalesce(pending_at, now()) where id = p_visitor;
  insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (p_visitor, 'registro', jsonb_build_object('via', 'union_manual'), auth.uid());
  perform public.cc_visitante_adoptar(null, p_profile);
  return jsonb_build_object('unida', true, 'visitor_id', p_visitor);
end;
$$;
alter function public.cc_enlace_candidatos(uuid) owner to postgres;
alter function public.cc_enlace_unir(uuid, uuid) owner to postgres;
revoke all on function public.cc_enlace_candidatos(uuid), public.cc_enlace_unir(uuid, uuid) from public, anon;
grant execute on function public.cc_enlace_candidatos(uuid), public.cc_enlace_unir(uuid, uuid) to authenticated, service_role;

do $post$ begin
  if has_function_privilege('authenticated', 'public.cc_escribiendo(uuid,text,text,uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.cc_enlace_unir(uuid,uuid)', 'execute')
     or has_table_privilege('anon', 'public.cc_respuestas_rapidas', 'select')
     or has_table_privilege('authenticated', 'public.cc_respuestas_rapidas', 'insert,update,delete') then
    raise exception 'CHAT-PRO: permisos inesperados';
  end if;
  if (select count(*) from public.cc_respuestas_rapidas where profile_id is null) <> 7 then raise exception 'CHAT-PRO: respuestas de la empresa incompletas'; end if;
end $post$;
