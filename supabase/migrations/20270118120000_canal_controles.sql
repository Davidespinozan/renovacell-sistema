-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B2-1 · CONTROLES POR CANAL (WhatsApp, Instagram, Messenger): modo + IA + pausa de envíos, auditados
--   Fuente de verdad única: las configuraciones existentes (cc_wa_config, cc_meta_config) reciben dos columnas:
--     · ia_habilitada  (false por defecto) — la IA solo puede estar encendida con el canal en 'activo' (CHECK).
--     · envio_pausado  (false por defecto) — freno de envíos (lo aplicarán la cola y el despacho en B2-2).
--   Pasar a 'espejo' apaga la IA en la MISMA sentencia (trigger BEFORE), también por SQL directo de emergencia.
--   Todo cambio efectivo queda en cc_canal_control_hist (trigger AFTER): por la RPC (origen 'rpc', con responsable y
--   motivo) o directo por SQL (origen 'directo').
--   RPC de Dirección: cc_canal_estado() (lectura) y cc_canal_cambiar(canal, cambios, motivo) (atómica, motivo obligatorio).
--   COMPUERTA: B2-1 NO hace seguro operar. Hasta B2-2 (pausa en cola/despacho) y B2-3 (IA primero, exclusividad e
--   ia_habilitada aplicada por el servidor), _cc_canal_activacion_lista() devuelve false y la RPC rechaza activar un
--   canal o encender la IA (ACTIVACION_BLOQUEADA). Solo una migración posterior la reemplaza. Pausar, reanudar,
--   apagar la IA y volver a espejo siempre están permitidos.
--   Sin efecto en la operación actual: hoy ningún flujo lee las columnas nuevas.
--   Rollback: supabase/rollback/canal_controles/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_config') is null or to_regclass('public.cc_meta_config') is null then raise exception 'R4-B2-1: faltan cc_wa_config (168) o cc_meta_config (170)'; end if;
  if to_regclass('public.cc_canal_control_hist') is not null then raise exception 'R4-B2-1: ya aplicada'; end if;
  if to_regprocedure('public._cc_es_admin()') is null or to_regprocedure('public.auth_role()') is null then raise exception 'R4-B2-1: faltan _cc_es_admin / auth_role'; end if;
  if (select count(*) from public.cc_meta_config where canal in ('instagram', 'messenger')) <> 2 then raise exception 'R4-B2-1: cc_meta_config sin instagram/messenger'; end if;
end $pre$;

alter table public.cc_wa_config
  add column ia_habilitada boolean not null default false,
  add column envio_pausado boolean not null default false,
  add constraint ck_wa_ia_requiere_activo check (not ia_habilitada or modo = 'activo');
alter table public.cc_meta_config
  add column ia_habilitada boolean not null default false,
  add column envio_pausado boolean not null default false,
  add constraint ck_meta_ia_requiere_activo check (not ia_habilitada or modo = 'activo');
comment on column public.cc_wa_config.ia_habilitada is 'R4-B2 · la IA atiende primero (solo con modo activo). La aplicará el servidor desde B2-3.';
comment on column public.cc_wa_config.envio_pausado is 'R4-B2 · freno de envíos (la cola y el despacho lo respetarán desde B2-2).';
comment on column public.cc_meta_config.ia_habilitada is 'R4-B2 · la IA atiende primero (solo con modo activo). La aplicará el servidor desde B2-3.';
comment on column public.cc_meta_config.envio_pausado is 'R4-B2 · freno de envíos (la cola y el despacho lo respetarán desde B2-2).';

create table public.cc_canal_control_hist (
  id               bigint generated always as identity primary key,
  canal            text not null check (canal in ('whatsapp', 'instagram', 'messenger')),
  antes            jsonb not null,
  despues          jsonb not null,
  origen           text not null check (origen in ('rpc', 'directo')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  motivo           text check (motivo is null or length(motivo) <= 500),
  created_at       timestamptz not null default now(),
  constraint ck_cch_rpc_completo check (origen <> 'rpc' or (actor_profile_id is not null and motivo is not null))
);
create index ix_cc_canal_control_hist on public.cc_canal_control_hist (created_at desc);
comment on table public.cc_canal_control_hist is 'R4-B2 · historial de cambios de modo / IA / pausa por canal. Solo lo escribe el trigger; se lee por cc_canal_estado().';
alter table public.cc_canal_control_hist enable row level security;
revoke all on table public.cc_canal_control_hist from public, anon, authenticated;
grant select on table public.cc_canal_control_hist to service_role;

-- BEFORE UPDATE: espejo ⇒ IA apagada (atómico, incluso por SQL directo) y updated_at al día si algo cambió.
create function public._cc_canal_control_normalizar() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if new.modo = 'espejo' then new.ia_habilitada := false; end if;
  if (new.modo, new.ia_habilitada, new.envio_pausado) is distinct from (old.modo, old.ia_habilitada, old.envio_pausado) then new.updated_at := now(); end if;
  return new;
end;
$$;

-- AFTER UPDATE: todo cambio efectivo al historial. La RPC deja origen/motivo en variables LOCALES de la transacción.
create function public._cc_canal_control_auditar() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_origen text := coalesce(nullif(current_setting('rc.canal_origen', true), ''), 'directo');
begin
  if (new.modo, new.ia_habilitada, new.envio_pausado) is not distinct from (old.modo, old.ia_habilitada, old.envio_pausado) then return null; end if;
  insert into public.cc_canal_control_hist (canal, antes, despues, origen, actor_profile_id, motivo)
  values (case when tg_table_name = 'cc_wa_config' then 'whatsapp' else (to_jsonb(new) ->> 'canal') end,
          jsonb_build_object('modo', old.modo, 'ia_habilitada', old.ia_habilitada, 'envio_pausado', old.envio_pausado),
          jsonb_build_object('modo', new.modo, 'ia_habilitada', new.ia_habilitada, 'envio_pausado', new.envio_pausado),
          v_origen,
          case when v_origen = 'rpc' then auth.uid() end,
          nullif(current_setting('rc.canal_motivo', true), ''));
  return null;
end;
$$;

create trigger trg_cc_wa_config_normalizar before update on public.cc_wa_config for each row execute function public._cc_canal_control_normalizar();
create trigger trg_cc_wa_config_auditar after update on public.cc_wa_config for each row execute function public._cc_canal_control_auditar();
create trigger trg_cc_meta_config_normalizar before update on public.cc_meta_config for each row execute function public._cc_canal_control_normalizar();
create trigger trg_cc_meta_config_auditar after update on public.cc_meta_config for each row execute function public._cc_canal_control_auditar();

-- COMPUERTA de activación. Constante a propósito: solo la migración que complete B2-2 y B2-3 la reemplaza.
create function public._cc_canal_activacion_lista() returns boolean
  language sql immutable set search_path = public as
$$ select false $$;
comment on function public._cc_canal_activacion_lista() is 'R4-B2-1 · false hasta que B2-2 (pausa en cola/despacho) y B2-3 (IA primero y exclusividad) estén aplicadas y probadas. Mientras sea false, cc_canal_cambiar no activa canales ni enciende la IA.';

-- Lectura para Dirección (o el servidor): estado por canal, compuerta e historial reciente. Sin datos de clientes.
create function public.cc_canal_estado() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not (public._cc_es_admin() or public._cc_es_service()) then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'activacion_disponible', public._cc_canal_activacion_lista(),
    'canales', (select jsonb_agg(x order by x ->> 'canal') from (
        select jsonb_build_object('canal', 'whatsapp', 'modo', w.modo, 'ia_habilitada', w.ia_habilitada, 'envio_pausado', w.envio_pausado, 'updated_at', w.updated_at) x from public.cc_wa_config w
        union all
        select jsonb_build_object('canal', m.canal, 'modo', m.modo, 'ia_habilitada', m.ia_habilitada, 'envio_pausado', m.envio_pausado, 'updated_at', m.updated_at) from public.cc_meta_config m
          where m.canal in ('instagram', 'messenger')) s),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('canal', h.canal, 'antes', h.antes, 'despues', h.despues, 'origen', h.origen,
                                                     'actor', coalesce(p.full_name, p.email), 'motivo', h.motivo, 'at', h.created_at) order by h.id desc)
                           from (select * from public.cc_canal_control_hist order by id desc limit 30) h left join public.profiles p on p.id = h.actor_profile_id), '[]'::jsonb));
end;
$$;

-- Cambio atómico y auditado. Solo Dirección (sesión de admin activa; ni servicio ni otros roles: siempre hay responsable).
create function public.cc_canal_cambiar(p_canal text, p_cambios jsonb, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); k text;
        a_modo text; a_ia boolean; a_pausa boolean; n_modo text; n_ia boolean; n_pausa boolean;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then raise exception 'CAMBIO_INVALIDO: se espera un objeto con modo, ia_habilitada o envio_pausado' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_cambios) loop
    if k not in ('modo', 'ia_habilitada', 'envio_pausado') then raise exception 'CAMBIO_INVALIDO: propiedad no permitida %', k using errcode = 'check_violation'; end if;
  end loop;
  if p_cambios ? 'modo' and (jsonb_typeof(p_cambios -> 'modo') <> 'string' or p_cambios ->> 'modo' not in ('espejo', 'activo')) then raise exception 'CAMBIO_INVALIDO: modo' using errcode = 'check_violation'; end if;
  if p_cambios ? 'ia_habilitada' and jsonb_typeof(p_cambios -> 'ia_habilitada') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: ia_habilitada' using errcode = 'check_violation'; end if;
  if p_cambios ? 'envio_pausado' and jsonb_typeof(p_cambios -> 'envio_pausado') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: envio_pausado' using errcode = 'check_violation'; end if;

  -- Fila bloqueada: los cambios concurrentes del mismo canal se serializan y cada uno decide sobre el estado vigente.
  if p_canal = 'whatsapp' then select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_wa_config where id for update;
  else select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_meta_config where canal = p_canal for update; end if;
  if a_modo is null then raise exception 'CANAL_INVALIDO: sin configuración para %', p_canal using errcode = 'check_violation'; end if;

  n_modo := coalesce(p_cambios ->> 'modo', a_modo);
  n_ia := coalesce((p_cambios ->> 'ia_habilitada')::boolean, a_ia);
  n_pausa := coalesce((p_cambios ->> 'envio_pausado')::boolean, a_pausa);
  if n_modo = 'espejo' and n_ia and p_cambios ? 'ia_habilitada' then raise exception 'IA_REQUIERE_ACTIVO: la IA solo se enciende con el canal en activo' using errcode = 'check_violation'; end if;
  if n_modo = 'espejo' then n_ia := false; end if;   -- volver a espejo apaga la IA en el mismo cambio

  if (n_modo, n_ia, n_pausa) is not distinct from (a_modo, a_ia, a_pausa) then
    return jsonb_build_object('cambiado', false, 'canal', p_canal, 'estado', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa));
  end if;
  if length(v_mot) < 5 then raise exception 'MOTIVO_REQUERIDO: explica el cambio (mínimo 5 caracteres)' using errcode = 'check_violation'; end if;
  if length(v_mot) > 500 then raise exception 'MOTIVO_LARGO: máximo 500 caracteres' using errcode = 'check_violation'; end if;
  if ((n_modo = 'activo' and a_modo <> 'activo') or (n_ia and not a_ia)) and not public._cc_canal_activacion_lista() then
    raise exception 'ACTIVACION_BLOQUEADA: activar el canal o encender la IA requiere completar R4-B2 (pausa en cola y exclusividad IA/humano)' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('rc.canal_origen', 'rpc', true);
  perform set_config('rc.canal_motivo', v_mot, true);
  if p_canal = 'whatsapp' then update public.cc_wa_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where id;   -- WHERE explícito (safeupdate)
  else update public.cc_meta_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where canal = p_canal; end if;
  perform set_config('rc.canal_origen', '', true);
  perform set_config('rc.canal_motivo', '', true);

  return jsonb_build_object('cambiado', true, 'canal', p_canal,
    'antes', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa),
    'despues', jsonb_build_object('modo', n_modo, 'ia_habilitada', n_ia, 'envio_pausado', n_pausa));
end;
$$;

alter function public._cc_canal_control_normalizar() owner to postgres;
alter function public._cc_canal_control_auditar() owner to postgres;
alter function public._cc_canal_activacion_lista() owner to postgres;
alter function public.cc_canal_estado() owner to postgres;
alter function public.cc_canal_cambiar(text, jsonb, text) owner to postgres;
revoke all on function public._cc_canal_control_normalizar(), public._cc_canal_control_auditar(), public._cc_canal_activacion_lista() from public, anon, authenticated;
revoke all on function public.cc_canal_estado(), public.cc_canal_cambiar(text, jsonb, text) from public, anon;
grant execute on function public.cc_canal_estado(), public.cc_canal_cambiar(text, jsonb, text) to authenticated, service_role;   -- la función exige Dirección por dentro

do $post$ begin
  if exists (select 1 from public.cc_wa_config where ia_habilitada or envio_pausado) or exists (select 1 from public.cc_meta_config where ia_habilitada or envio_pausado) then
    raise exception 'R4-B2-1: los valores iniciales no quedaron en false';
  end if;
  if public._cc_canal_activacion_lista() then raise exception 'R4-B2-1: la compuerta de activación debe nacer cerrada'; end if;
  if has_function_privilege('anon', 'public.cc_canal_cambiar(text,jsonb,text)', 'execute') or has_function_privilege('anon', 'public.cc_canal_estado()', 'execute')
     or has_function_privilege('authenticated', 'public._cc_canal_activacion_lista()', 'execute') then raise exception 'R4-B2-1: permisos de más'; end if;
  if has_table_privilege('authenticated', 'public.cc_canal_control_hist', 'select') or has_table_privilege('authenticated', 'public.cc_canal_control_hist', 'insert') then
    raise exception 'R4-B2-1: el historial no debe ser accesible directo';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_cc_wa_config_normalizar', 'trg_cc_wa_config_auditar', 'trg_cc_meta_config_normalizar', 'trg_cc_meta_config_auditar')) <> 4 then
    raise exception 'R4-B2-1: faltan triggers';
  end if;
end $post$;
