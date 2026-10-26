-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B2-2 · COLA Y DESPACHO SEGURO (WhatsApp, Instagram, Messenger)
--   Estados de salida: pendiente · enviando · enviado · fallido · fuera_ventana (existentes, intactos)
--                      + retenido (pausa / canal fuera de activo) · incierto (no se sabe si Meta lo aceptó) · descartado.
--   · Pausa real: con envio_pausado (o el canal fuera de 'activo') nada se reclama; lo nuevo se encola como 'retenido'; al
--     pausar, lo 'pendiente' pasa a 'retenido' en la MISMA transacción del cambio. La Edge vuelve a preguntar
--     (cc_*_salida_puede_enviar) ANTES de cada POST: tras una pausa confirmada no empieza ningún envío nuevo. Un POST
--     ya iniciado no se puede cancelar.
--   · Reanudar NO libera ni descarta nada: lo retenido espera la decisión de Dirección (cc_salida_decidir, auditada).
--   · Incierto (timeout, red, 5xx, 2xx sin id, 'enviando' colgado > 5 min): sin reintento automático; solo se descarta
--     a mano (nunca se reenvía a ciegas). Reintento automático SOLO si Meta rechazó por límite (429 y códigos de cupo).
--   · Clase del resultado: la Edge nueva la manda como prefijo de p_error ('definitivo|…', 'reintentable|…',
--     'incierto|…', 'retener|…'); si no viene (Edge anterior), el servidor la deduce del texto. Firma intacta.
--   · Avisos de sistema que SÍ salen por el canal: solo sys:wa: (WhatsApp), sys:instagram: / sys:messenger: (su canal),
--     sys:solicitud: y sys:falla_ia:. Ningún otro 'sys:'.
--   No abre la compuerta de activación. No toca funciones del trabajo CV.
--   Rollback: supabase/rollback/cola_salida_segura/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_ia_permitida_en(uuid,boolean)') is null or to_regclass('public.cc_canal_control_hist') is null then raise exception 'R4-B2-2: faltan R4-B2-1 y R4-B2-3a'; end if;
  if to_regclass('public.cc_salida_decisiones') is not null then raise exception 'R4-B2-2: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) <> 'b9a9a49dee1824dff66a300f23719afb'
     or md5(pg_get_functiondef('public._cc_meta_encolar()'::regprocedure)) <> '24d3218f716f88c73629cad1db0dbced'
     or md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure)) <> '028f05722b9265233963494ef6f75d9c'
     or md5(pg_get_functiondef('public.cc_meta_salida_reclamar(integer)'::regprocedure)) <> '07d343bc5ab54bff5fe2a15eff215c0f'
     or md5(pg_get_functiondef('public.cc_wa_salida_resolver(uuid,boolean,text,text)'::regprocedure)) <> '6c0551870b9aeaacba853a2ee5aa4220'
     or md5(pg_get_functiondef('public.cc_meta_salida_resolver(uuid,boolean,text,text)'::regprocedure)) <> 'cb3b825798d8ea1addd2968ceaa21558' then
    raise exception 'R4-B2-2: alguna función de la cola no tiene la definición esperada (producción 26 oct 2026)';
  end if;
end $pre$;

-- ── Estados y evidencia ──────────────────────────────────────────────────────────────────────────────
alter table public.cc_wa_salida drop constraint cc_wa_salida_estado_check;
alter table public.cc_wa_salida
  add constraint cc_wa_salida_estado_check check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana', 'retenido', 'incierto', 'descartado')),
  add column retenido_at timestamptz, add column incierto_at timestamptz, add column resultado jsonb,
  add column decidido_at timestamptz, add column decidido_por uuid references public.profiles(id) on delete set null,
  add column decision_motivo text check (decision_motivo is null or length(decision_motivo) <= 500),
  add constraint ck_wa_salida_descartado_decidido check (estado <> 'descartado' or decidido_at is not null);
alter table public.cc_meta_salida drop constraint cc_meta_salida_estado_check;
alter table public.cc_meta_salida
  add constraint cc_meta_salida_estado_check check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana', 'retenido', 'incierto', 'descartado')),
  add column retenido_at timestamptz, add column incierto_at timestamptz, add column resultado jsonb,
  add column decidido_at timestamptz, add column decidido_por uuid references public.profiles(id) on delete set null,
  add column decision_motivo text check (decision_motivo is null or length(decision_motivo) <= 500),
  add constraint ck_meta_salida_descartado_decidido check (estado <> 'descartado' or decidido_at is not null);
create index ix_cc_wa_salida_revision on public.cc_wa_salida (estado, created_at) where estado in ('retenido', 'incierto');
create index ix_cc_meta_salida_revision on public.cc_meta_salida (canal, estado, created_at) where estado in ('retenido', 'incierto');

-- Auditoría de decisiones de Dirección (una fila por mensaje decidido; 'lote' agrupa la operación).
create table public.cc_salida_decisiones (
  id               bigint generated always as identity primary key,
  lote             uuid not null,
  canal            text not null check (canal in ('whatsapp', 'instagram', 'messenger')),
  salida_id        uuid not null,
  accion           text not null check (accion in ('liberar', 'descartar')),
  estado_antes     text not null,
  estado_despues   text not null,
  motivo           text not null check (length(motivo) between 5 and 500),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index ix_cc_salida_decisiones on public.cc_salida_decisiones (salida_id, created_at);
alter table public.cc_salida_decisiones enable row level security;
revoke all on table public.cc_salida_decisiones from public, anon, authenticated;
grant select on table public.cc_salida_decisiones to service_role;

-- ── Ayudantes ───────────────────────────────────────────────────────────────────────────────────────
-- ¿Puede enviar hoy el canal? (activo y sin pausa). p_bloquear: candado COMPARTIDO de la configuración, que se ordena
-- contra cc_canal_cambiar (FOR UPDATE): o la pausa ya se confirmó y se ve, o espera a que esta operación termine.
create function public._cc_canal_envio_habilitado(p_canal text, p_bloquear boolean default false) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare v boolean;
begin
  if p_canal = 'whatsapp' then
    if p_bloquear then select modo = 'activo' and not envio_pausado into v from public.cc_wa_config where id for share;
    else select modo = 'activo' and not envio_pausado into v from public.cc_wa_config where id; end if;
  elsif p_canal in ('instagram', 'messenger') then
    if p_bloquear then select modo = 'activo' and not envio_pausado into v from public.cc_meta_config where canal = p_canal for share;
    else select modo = 'activo' and not envio_pausado into v from public.cc_meta_config where canal = p_canal; end if;
  end if;
  return coalesce(v, false);
end;
$$;

-- Avisos de sistema que pueden salir por el canal (por identificador de origen; el texto no autoriza nada).
create function public._cc_aviso_canal_permitido(p_client_id text, p_canal text) returns boolean
  language sql immutable set search_path = public as
$$
  select coalesce(p_client_id, '') like 'sys:solicitud:%' or coalesce(p_client_id, '') like 'sys:falla_ia:%'
      or (p_canal = 'whatsapp' and coalesce(p_client_id, '') like 'sys:wa:%')
      or (p_canal in ('instagram', 'messenger') and coalesce(p_client_id, '') like 'sys:' || p_canal || ':%')
$$;

-- Clase de un resultado no exitoso. Prefijo explícito de la Edge nueva; si no, se deduce del texto de la Edge anterior.
create function public._cc_clase_envio(p_error text) returns text
  language sql immutable set search_path = public as
$$
  select case
    when split_part(coalesce(p_error, ''), '|', 1) in ('definitivo', 'reintentable', 'incierto', 'retener') then split_part(p_error, '|', 1)
    when coalesce(p_error, '') ilike 'sin respuesta de Meta%' then 'incierto'                          -- timeout / red: ¿llegó?
    when p_error ~ '^Meta 429' then 'reintentable'                                                     -- rechazado por cupo
    when p_error ~ '^Meta [0-9]{3} \((4|17|32|613|80007|130429|131048|131056)\)' then 'reintentable'
    when p_error ~ '^Meta 5' then 'incierto'
    when p_error ~ '^Meta [0-9]{3} \((1|2|131000)\)' then 'incierto'
    when p_error ~ '^Meta 2' then 'incierto'                                                           -- 2xx sin identificador
    when p_error ~ '^Meta 4' then 'definitivo'
    else 'incierto' end
$$;
create function public._cc_detalle_envio(p_error text) returns text
  language sql immutable set search_path = public as
$$
  select left(case when split_part(coalesce(p_error, ''), '|', 1) in ('definitivo', 'reintentable', 'incierto', 'retener')
                   then substr(p_error, position('|' in p_error) + 1) else coalesce(nullif(btrim(p_error), ''), 'sin detalle') end, 300)
$$;

-- Al pausar o sacar el canal de 'activo': lo pendiente pasa a retenido en la misma transacción del cambio.
create function public._cc_canal_retener_pendientes() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_motivo text;
begin
  if (new.envio_pausado and not old.envio_pausado) then v_motivo := 'pausa';
  elsif (new.modo <> 'activo' and old.modo = 'activo') then v_motivo := 'canal_no_activo';
  else return null; end if;
  if tg_table_name = 'cc_wa_config' then
    update public.cc_wa_salida set estado = 'retenido', retenido_at = now(), resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', v_motivo)
     where estado = 'pendiente';
  else
    update public.cc_meta_salida set estado = 'retenido', retenido_at = now(), resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', v_motivo)
     where estado = 'pendiente' and canal = (to_jsonb(new) ->> 'canal');
  end if;
  return null;
end;
$$;
create trigger trg_cc_wa_config_retener after update on public.cc_wa_config for each row execute function public._cc_canal_retener_pendientes();
create trigger trg_cc_meta_config_retener after update on public.cc_meta_config for each row execute function public._cc_canal_retener_pendientes();

-- ── Encolado (WhatsApp / Meta) ──────────────────────────────────────────────────────────────────────
create or replace function public._cc_wa_encolar() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_wa_contactos; v_modo text; v_pausa boolean; v_estado text;
begin
  if not (new.actor_type in ('seller', 'admin', 'ai') or (new.actor_type = 'system' and public._cc_aviso_canal_permitido(new.client_message_id, 'whatsapp'))) then return new; end if;
  -- candado compartido: se ordena contra una pausa en curso (o ya se ve, o la pausa retiene esta fila al confirmarse)
  select modo, envio_pausado into v_modo, v_pausa from public.cc_wa_config where id for share;
  if v_modo is distinct from 'activo' then return new; end if;
  k := public._cc_wa_contacto_de(new.conversation_id);
  if k.wa_id is null then return new; end if;
  v_estado := case when not (k.ultimo_entrante_at > now() - interval '24 hours') or k.ultimo_entrante_at is null then 'fuera_ventana' when v_pausa then 'retenido' else 'pendiente' end;
  insert into public.cc_wa_salida (message_id, conversation_id, wa_id, texto, estado, retenido_at, resultado)
  values (new.id, new.conversation_id, k.wa_id, left(new.content, 4000), v_estado,
          case when v_estado = 'retenido' then now() end, case when v_estado = 'retenido' then jsonb_build_object('retenido_por', 'pausa') end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'WA_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- WhatsApp nunca tumba el mensaje del chat
  return new;
end;
$$;

create or replace function public._cc_meta_encolar() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_meta_contactos; v_modo text; v_pausa boolean; v_estado text;
begin
  if new.actor_type not in ('seller', 'admin', 'ai', 'system') then return new; end if;
  k := public._cc_meta_contacto_de(new.conversation_id);
  if k.psid is null then return new; end if;
  if new.actor_type = 'system' and not public._cc_aviso_canal_permitido(new.client_message_id, k.canal) then return new; end if;
  select modo, envio_pausado into v_modo, v_pausa from public.cc_meta_config where canal = k.canal for share;
  if v_modo is distinct from 'activo' then return new; end if;
  v_estado := case when not (k.ultimo_entrante_at > now() - interval '24 hours') or k.ultimo_entrante_at is null then 'fuera_ventana' when v_pausa then 'retenido' else 'pendiente' end;
  insert into public.cc_meta_salida (message_id, conversation_id, canal, psid, texto, estado, retenido_at, resultado)
  values (new.id, new.conversation_id, k.canal, k.psid, left(new.content, 4000), v_estado,
          case when v_estado = 'retenido' then now() end, case when v_estado = 'retenido' then jsonb_build_object('retenido_por', 'pausa') end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'META_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- Meta nunca tumba el mensaje del chat
  return new;
end;
$$;

-- ── Reclamo: solo con el canal habilitado; los 'enviando' colgados > 5 min pasan a incierto (nunca se re-reclaman) ──
create or replace function public.cc_wa_salida_reclamar(p_limite int default 20) returns setof public.cc_wa_salida
  language plpgsql security definer set search_path = public as
$$
declare v_ok boolean;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_salida set estado = 'incierto', incierto_at = now(),
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('clase', 'incierto', 'detalle', 'sin resolución 5 min después de reclamarse')
   where estado = 'enviando' and reclamado_at < now() - interval '5 minutes';
  v_ok := public._cc_canal_envio_habilitado('whatsapp', true);
  if not v_ok then return; end if;
  return query
  update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_wa_salida x
                   where x.estado = 'pendiente' and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$$;

create or replace function public.cc_meta_salida_reclamar(p_limite int default 20) returns setof public.cc_meta_salida
  language plpgsql security definer set search_path = public as
$$
declare v_ig boolean; v_fb boolean;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_meta_salida set estado = 'incierto', incierto_at = now(),
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('clase', 'incierto', 'detalle', 'sin resolución 5 min después de reclamarse')
   where estado = 'enviando' and reclamado_at < now() - interval '5 minutes';
  v_ig := public._cc_canal_envio_habilitado('instagram', true);
  v_fb := public._cc_canal_envio_habilitado('messenger', true);
  if not (v_ig or v_fb) then return; end if;
  return query
  update public.cc_meta_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_meta_salida x
                   where x.estado = 'pendiente' and x.intentos < 5 and ((x.canal = 'instagram' and v_ig) or (x.canal = 'messenger' and v_fb))
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$$;

-- ── Verificación justo antes de cada POST (la llama la Edge por mensaje) ─────────────────────────────
create function public.cc_wa_salida_puede_enviar(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return public._cc_canal_envio_habilitado('whatsapp', true)
     and exists (select 1 from public.cc_wa_salida where id = p_id and estado = 'enviando' and reclamado_at > now() - interval '5 minutes');
end;
$$;
create function public.cc_meta_salida_puede_enviar(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare v_canal text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select canal into v_canal from public.cc_meta_salida where id = p_id and estado = 'enviando' and reclamado_at > now() - interval '5 minutes';
  return v_canal is not null and public._cc_canal_envio_habilitado(v_canal, true);
end;
$$;

-- ── Resolución (misma firma; la clase viene en p_error o se deduce) ──────────────────────────────────
create or replace function public.cc_wa_salida_resolver(p_id uuid, p_ok boolean, p_wamid text, p_error text) returns void
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_wa_salida; v_clase text; v_det text; v_estado text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_wa_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_wamid, '')), '') is not null then
    update public.cc_wa_salida set estado = 'enviado', wamid = p_wamid, enviado_at = now(), error = null,
           resultado = jsonb_build_object('clase', 'enviado', 'intento', s.intentos, 'at', now()) where id = p_id;
    insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (p_wamid, s.wa_id, s.conversation_id, s.message_id, 'out') on conflict do nothing;
    return;
  end if;
  v_clase := public._cc_clase_envio(p_error); v_det := public._cc_detalle_envio(p_error);
  v_estado := case v_clase when 'retener' then 'retenido' when 'incierto' then 'incierto' when 'definitivo' then 'fallido'
                           else case when s.intentos >= 5 then 'fallido' when not public._cc_canal_envio_habilitado('whatsapp') then 'retenido' else 'pendiente' end end;
  update public.cc_wa_salida set estado = v_estado, error = v_det,
         retenido_at = case when v_estado = 'retenido' then now() else retenido_at end,
         incierto_at = case when v_estado = 'incierto' then now() else incierto_at end,
         resultado = jsonb_build_object('clase', v_clase, 'detalle', v_det, 'intento', s.intentos, 'at', now())
   where id = p_id;
end;
$$;

create or replace function public.cc_meta_salida_resolver(p_id uuid, p_ok boolean, p_mid text, p_error text) returns void
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_meta_salida; v_clase text; v_det text; v_estado text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_meta_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_mid, '')), '') is not null then
    update public.cc_meta_salida set estado = 'enviado', mid = p_mid, enviado_at = now(), error = null,
           resultado = jsonb_build_object('clase', 'enviado', 'intento', s.intentos, 'at', now()) where id = p_id;
    insert into public.cc_meta_mensajes (mid, canal, psid, conversation_id, message_id, direccion) values (p_mid, s.canal, s.psid, s.conversation_id, s.message_id, 'out') on conflict do nothing;
    return;
  end if;
  v_clase := public._cc_clase_envio(p_error); v_det := public._cc_detalle_envio(p_error);
  v_estado := case v_clase when 'retener' then 'retenido' when 'incierto' then 'incierto' when 'definitivo' then 'fallido'
                           else case when s.intentos >= 5 then 'fallido' when not public._cc_canal_envio_habilitado(s.canal) then 'retenido' else 'pendiente' end end;
  update public.cc_meta_salida set estado = v_estado, error = v_det,
         retenido_at = case when v_estado = 'retenido' then now() else retenido_at end,
         incierto_at = case when v_estado = 'incierto' then now() else incierto_at end,
         resultado = jsonb_build_object('clase', v_clase, 'detalle', v_det, 'intento', s.intentos, 'at', now())
   where id = p_id;
end;
$$;

-- ── Dirección: revisión y decisión manual ───────────────────────────────────────────────────────────
-- Lo que espera decisión (retenido / incierto) y conteos por estado. Sin números completos.
create function public.cc_salida_revision(p_canal text, p_limite int default 50) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_lim int := greatest(1, least(coalesce(p_limite, 50), 200));
begin
  if auth.uid() is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  if p_canal = 'whatsapp' then
    return jsonb_build_object('canal', p_canal, 'envio_habilitado', public._cc_canal_envio_habilitado(p_canal),
      'conteos', (select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) from (select estado, count(*) n from public.cc_wa_salida group by estado) x),
      'por_decidir', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'estado', s.estado, 'conversation_id', s.conversation_id, 'creado', s.created_at,
                    'texto', left(s.texto, 200), 'error', s.error, 'resultado', s.resultado, 'contacto', '…' || right(s.wa_id, 4),
                    'ventana_abierta', w.ultimo_entrante_at > now() - interval '24 hours') order by s.created_at)
               from (select * from public.cc_wa_salida where estado in ('retenido', 'incierto') order by created_at limit v_lim) s
               left join public.cc_wa_contactos w on w.wa_id = s.wa_id), '[]'::jsonb));
  end if;
  return jsonb_build_object('canal', p_canal, 'envio_habilitado', public._cc_canal_envio_habilitado(p_canal),
    'conteos', (select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) from (select estado, count(*) n from public.cc_meta_salida where canal = p_canal group by estado) x),
    'por_decidir', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'estado', s.estado, 'conversation_id', s.conversation_id, 'creado', s.created_at,
                  'texto', left(s.texto, 200), 'error', s.error, 'resultado', s.resultado,
                  'ventana_abierta', m.ultimo_entrante_at > now() - interval '24 hours') order by s.created_at)
             from (select * from public.cc_meta_salida where canal = p_canal and estado in ('retenido', 'incierto') order by created_at limit v_lim) s
             left join public.cc_meta_contactos m on m.canal = s.canal and m.psid = s.psid), '[]'::jsonb));
end;
$$;

-- Decisión explícita por mensaje: 'liberar' (retenido → pendiente; canal activo y sin pausa; dentro de la ventana de 24 h)
-- o 'descartar' (retenido / incierto → descartado; un incierto NUNCA se reenvía a ciegas). Resultado por mensaje.
create function public.cc_salida_decidir(p_canal text, p_ids uuid[], p_accion text, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); v_lote uuid := gen_random_uuid(); v_id uuid;
        v_res jsonb := '[]'::jsonb; v_ok int := 0; v_estado text; v_canal_fila text; v_ult timestamptz; v_hab boolean; v_r text;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  if p_accion is null or p_accion not in ('liberar', 'descartar') then raise exception 'ACCION_INVALIDA: liberar o descartar' using errcode = 'check_violation'; end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 100 then raise exception 'SELECCION_INVALIDA: de 1 a 100 mensajes' using errcode = 'check_violation'; end if;
  if length(v_mot) < 5 then raise exception 'MOTIVO_REQUERIDO: explica la decisión (mínimo 5 caracteres)' using errcode = 'check_violation'; end if;
  if length(v_mot) > 500 then raise exception 'MOTIVO_LARGO: máximo 500 caracteres' using errcode = 'check_violation'; end if;
  -- liberar exige el canal habilitado; el candado compartido lo mantiene así hasta confirmar (una pausa espera y luego retiene)
  v_hab := public._cc_canal_envio_habilitado(p_canal, true);
  if p_accion = 'liberar' and not v_hab then raise exception 'CANAL_NO_HABILITADO: no se libera con el canal en espejo o en pausa' using errcode = 'check_violation'; end if;

  for v_id in select distinct x from unnest(p_ids) x order by 1 loop   -- orden fijo: sin interbloqueos entre lotes
    v_estado := null; v_canal_fila := null; v_ult := null;
    if p_canal = 'whatsapp' then
      select s.estado, 'whatsapp', w.ultimo_entrante_at into v_estado, v_canal_fila, v_ult
        from public.cc_wa_salida s left join public.cc_wa_contactos w on w.wa_id = s.wa_id where s.id = v_id for update of s;
    else
      select s.estado, s.canal, m.ultimo_entrante_at into v_estado, v_canal_fila, v_ult
        from public.cc_meta_salida s left join public.cc_meta_contactos m on m.canal = s.canal and m.psid = s.psid where s.id = v_id for update of s;
    end if;
    v_r := case when v_estado is null then case when exists (select 1 from public.cc_wa_salida where id = v_id) or exists (select 1 from public.cc_meta_salida where id = v_id)
                                                then 'otro_canal' else 'no_encontrado' end
                when v_canal_fila <> p_canal then 'otro_canal'
                when p_accion = 'liberar' and v_estado <> 'retenido' then 'estado_invalido'
                when p_accion = 'descartar' and v_estado not in ('retenido', 'incierto') then 'estado_invalido'
                when p_accion = 'liberar' and not coalesce(v_ult > now() - interval '24 hours', false) then 'fuera_de_ventana'   -- sin dato de ventana: no se libera
                else null end;
    if v_r is null then
      if p_canal = 'whatsapp' then
        update public.cc_wa_salida set estado = case when p_accion = 'liberar' then 'pendiente' else 'descartado' end,
               decidido_at = now(), decidido_por = v_uid, decision_motivo = v_mot where id = v_id;
      else
        update public.cc_meta_salida set estado = case when p_accion = 'liberar' then 'pendiente' else 'descartado' end,
               decidido_at = now(), decidido_por = v_uid, decision_motivo = v_mot where id = v_id;
      end if;
      insert into public.cc_salida_decisiones (lote, canal, salida_id, accion, estado_antes, estado_despues, motivo, actor_profile_id)
      values (v_lote, p_canal, v_id, p_accion, v_estado, case when p_accion = 'liberar' then 'pendiente' else 'descartado' end, v_mot, v_uid);
      v_r := case when p_accion = 'liberar' then 'liberado' else 'descartado' end; v_ok := v_ok + 1;
    end if;
    v_res := v_res || jsonb_build_object('id', v_id, 'resultado', v_r);
  end loop;
  return jsonb_build_object('lote', v_lote, 'canal', p_canal, 'accion', p_accion, 'aplicados', v_ok, 'total', jsonb_array_length(v_res), 'resultados', v_res);
end;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────────────────────────────
alter function public._cc_canal_envio_habilitado(text, boolean) owner to postgres;
alter function public._cc_aviso_canal_permitido(text, text) owner to postgres;
alter function public._cc_clase_envio(text) owner to postgres;
alter function public._cc_detalle_envio(text) owner to postgres;
alter function public._cc_canal_retener_pendientes() owner to postgres;
alter function public.cc_wa_salida_puede_enviar(uuid) owner to postgres;
alter function public.cc_meta_salida_puede_enviar(uuid) owner to postgres;
alter function public.cc_salida_revision(text, int) owner to postgres;
alter function public.cc_salida_decidir(text, uuid[], text, text) owner to postgres;
revoke all on function public._cc_canal_envio_habilitado(text, boolean), public._cc_aviso_canal_permitido(text, text), public._cc_clase_envio(text),
  public._cc_detalle_envio(text), public._cc_canal_retener_pendientes() from public, anon, authenticated;
revoke all on function public.cc_wa_salida_puede_enviar(uuid), public.cc_meta_salida_puede_enviar(uuid) from public, anon, authenticated;
grant execute on function public.cc_wa_salida_puede_enviar(uuid), public.cc_meta_salida_puede_enviar(uuid) to service_role;
revoke all on function public.cc_salida_revision(text, int), public.cc_salida_decidir(text, uuid[], text, text) from public, anon;
grant execute on function public.cc_salida_revision(text, int), public.cc_salida_decidir(text, uuid[], text, text) to authenticated;   -- exigen Dirección por dentro

do $post$ begin
  if public._cc_canal_activacion_lista() then raise exception 'R4-B2-2: la compuerta de activación debe seguir cerrada'; end if;
  if public._cc_clase_envio('sin respuesta de Meta (timeout)') <> 'incierto' or public._cc_clase_envio('Meta 400 (10): x') <> 'definitivo'
     or public._cc_clase_envio('Meta 429: x') <> 'reintentable' or public._cc_clase_envio('Meta 500: x') <> 'incierto'
     or public._cc_clase_envio('retener|pausa') <> 'retener' or public._cc_clase_envio('Meta 200: sin detalle') <> 'incierto' then
    raise exception 'R4-B2-2: clasificación de resultados inesperada';
  end if;
  if public._cc_aviso_canal_permitido('sys:ia_no_disponible', 'whatsapp') or public._cc_aviso_canal_permitido('sys:handoff:1', 'whatsapp')
     or public._cc_aviso_canal_permitido('sys:wa:1', 'instagram') or not public._cc_aviso_canal_permitido('sys:wa:1', 'whatsapp') then
    raise exception 'R4-B2-2: lista de avisos de sistema inesperada';
  end if;
  if has_function_privilege('authenticated', 'public.cc_wa_salida_puede_enviar(uuid)', 'execute') or has_table_privilege('authenticated', 'public.cc_salida_decisiones', 'select') then
    raise exception 'R4-B2-2: permisos de más';
  end if;
end $post$;
