-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AVISOS AL TELÉFONO (migración 160) · NOTIFICACIONES PUSH DEL CHAT, COMO EN UN MENSAJERO
--   Decisión del dueño (15 oct 2026): que el cliente se entere de que su asesor le respondió aunque haya cerrado la
--   pestaña, y que el vendedor se entere de que su cliente le escribió. Cada teléfono o computadora que acepta los
--   avisos deja aquí su "dirección" de notificaciones (Web Push estándar). Solo el servidor la usa.
--   · push_suscripciones          NUEVA. Una fila por dispositivo (endpoint único), de una cuenta o de un visitante.
--   · push_suscribir              NUEVA (servidor). Alta o renovación del dispositivo.
--   · push_baja                   NUEVA (servidor). El dispositivo deja de recibir avisos.
--   · push_destinos               NUEVA (servidor). Dispositivos activos de unas cuentas o visitantes.
--   · push_resultado              NUEVA (servidor). Si el navegador dice que la dirección ya no existe, se apaga.
--   NO cambia: mensajes, conversaciones, permisos ni avisos dentro del sistema.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/avisos_push/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.push_suscripciones') is not null then raise exception 'AVISOS-PUSH: ya aplicada'; end if;
end $pre$;

create table public.push_suscripciones (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  visitor_id   uuid references public.cc_visitors(id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh       text not null check (length(p256dh) between 20 and 200),
  auth         text not null check (length(auth) between 8 and 100),
  activo       boolean not null default true,
  fallos       integer not null default 0,
  creado_at    timestamptz not null default now(),
  ultimo_ok_at timestamptz,
  check ((profile_id is null) <> (visitor_id is null))
);
comment on table public.push_suscripciones is 'AVISOS PUSH · dirección de notificaciones de un dispositivo. Solo el servidor la lee y la usa.';
create index ix_push_profile on public.push_suscripciones (profile_id) where activo;
create index ix_push_visitor on public.push_suscripciones (visitor_id) where activo;
alter table public.push_suscripciones enable row level security;   -- sin políticas: solo comandos del servidor
revoke all on table public.push_suscripciones from public, anon, authenticated;
grant select, insert, update, delete on table public.push_suscripciones to service_role;

create function public.push_suscribir(p_profile uuid, p_visitor_hash text, p_endpoint text, p_p256dh text, p_auth text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- Un dispositivo pertenece a UNA identidad: si antes era de otra (otra cuenta en el mismo teléfono), pasa a la actual.
declare v_vis uuid; r public.push_suscripciones;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_profile is null then
    v_vis := public._cc_visitor_por_hash(p_visitor_hash);
    if v_vis is null then raise exception 'SESION_INVALIDA'; end if;
  end if;
  insert into public.push_suscripciones (profile_id, visitor_id, endpoint, p256dh, auth)
  values (p_profile, v_vis, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set profile_id = excluded.profile_id, visitor_id = excluded.visitor_id, p256dh = excluded.p256dh, auth = excluded.auth, activo = true, fallos = 0
  returning * into r;
  return jsonb_build_object('id', r.id, 'activo', true);
end;
$$;

create function public.push_baja(p_endpoint text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.push_suscripciones set activo = false where endpoint = p_endpoint;
end;
$$;

create function public.push_destinos(p_profiles uuid[], p_visitors uuid[]) returns table (id uuid, endpoint text, p256dh text, auth text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return query select s.id, s.endpoint, s.p256dh, s.auth from public.push_suscripciones s
   where s.activo and (s.profile_id = any (coalesce(p_profiles, '{}')) or s.visitor_id = any (coalesce(p_visitors, '{}')));
end;
$$;

create function public.push_resultado(p_id uuid, p_ok boolean, p_baja boolean) returns void
  language plpgsql security definer set search_path = public as
$$
-- p_baja: el servicio de avisos dijo que la dirección ya no existe (el usuario los quitó o desinstaló): se apaga.
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_ok then update public.push_suscripciones set ultimo_ok_at = now(), fallos = 0 where id = p_id;
  else update public.push_suscripciones set fallos = fallos + 1, activo = case when p_baja or fallos + 1 >= 5 then false else activo end where id = p_id;
  end if;
end;
$$;

alter function public.push_suscribir(uuid, text, text, text, text) owner to postgres;
alter function public.push_baja(text) owner to postgres;
alter function public.push_destinos(uuid[], uuid[]) owner to postgres;
alter function public.push_resultado(uuid, boolean, boolean) owner to postgres;
revoke all on function public.push_suscribir(uuid, text, text, text, text), public.push_baja(text), public.push_destinos(uuid[], uuid[]), public.push_resultado(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.push_suscribir(uuid, text, text, text, text), public.push_baja(text), public.push_destinos(uuid[], uuid[]), public.push_resultado(uuid, boolean, boolean) to service_role;
