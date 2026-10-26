-- R4-B2-2 · ROLLBACK: la cola vuelve EXACTAMENTE a producción del 26 oct 2026 (reclamo sin pausa, todo error se reintenta,
-- solo personal/IA se encola) y se retiran estados, evidencia, decisiones, verificación previa y RPC de Dirección.
-- Aborta si hay mensajes en retenido / incierto / descartado (decidirlos antes: no se pierde nada en silencio).
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
do $pre$ begin
  if exists (select 1 from public.cc_wa_salida where estado in ('retenido', 'incierto', 'descartado'))
     or exists (select 1 from public.cc_meta_salida where estado in ('retenido', 'incierto', 'descartado')) then
    raise exception 'R4-B2-2 down: hay mensajes retenidos, inciertos o descartados; no se revierte sin decidirlos';
  end if;
end $pre$;
drop function if exists public.cc_salida_decidir(text, uuid[], text, text);
drop function if exists public.cc_salida_revision(text, int);
drop function if exists public.cc_wa_salida_puede_enviar(uuid);
drop function if exists public.cc_meta_salida_puede_enviar(uuid);
drop trigger if exists trg_cc_wa_config_retener on public.cc_wa_config;
drop trigger if exists trg_cc_meta_config_retener on public.cc_meta_config;
CREATE OR REPLACE FUNCTION public._cc_meta_encolar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k public.cc_meta_contactos;
begin
  if new.actor_type not in ('seller', 'admin', 'ai') then return new; end if;
  k := public._cc_meta_contacto_de(new.conversation_id);
  if k.psid is null then return new; end if;
  if (select modo from public.cc_meta_config where canal = k.canal) <> 'activo' then return new; end if;
  insert into public.cc_meta_salida (message_id, conversation_id, canal, psid, texto, estado)
  values (new.id, new.conversation_id, k.canal, k.psid, left(new.content, 4000),
          case when k.ultimo_entrante_at > now() - interval '24 hours' then 'pendiente' else 'fuera_ventana' end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'META_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- Meta nunca tumba el mensaje del chat
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._cc_wa_encolar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k public.cc_wa_contactos;
begin
  if new.actor_type not in ('seller', 'admin', 'ai') then return new; end if;
  if (select modo from public.cc_wa_config) <> 'activo' then return new; end if;
  k := public._cc_wa_contacto_de(new.conversation_id);
  if k.wa_id is null then return new; end if;
  insert into public.cc_wa_salida (message_id, conversation_id, wa_id, texto, estado)
  values (new.id, new.conversation_id, k.wa_id, left(new.content, 4000),
          case when k.ultimo_entrante_at > now() - interval '24 hours' then 'pendiente' else 'fuera_ventana' end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'WA_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- WhatsApp nunca tumba el mensaje del chat
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_meta_salida_reclamar(p_limite integer DEFAULT 20)
 RETURNS SETOF cc_meta_salida
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return query
  update public.cc_meta_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_meta_salida x
                   where (x.estado = 'pendiente' or (x.estado = 'enviando' and x.reclamado_at < now() - interval '2 minutes'))
                     and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_meta_salida_resolver(p_id uuid, p_ok boolean, p_mid text, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.cc_meta_salida;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_meta_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_mid, '')), '') is not null then
    update public.cc_meta_salida set estado = 'enviado', mid = p_mid, enviado_at = now(), error = null where id = p_id;
    insert into public.cc_meta_mensajes (mid, canal, psid, conversation_id, message_id, direccion) values (p_mid, s.canal, s.psid, s.conversation_id, s.message_id, 'out') on conflict do nothing;
  else
    update public.cc_meta_salida set estado = case when s.intentos >= 5 then 'fallido' else 'pendiente' end, error = left(coalesce(p_error, 'sin detalle'), 300) where id = p_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_wa_salida_reclamar(p_limite integer DEFAULT 20)
 RETURNS SETOF cc_wa_salida
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return query
  update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_wa_salida x
                   where (x.estado = 'pendiente' or (x.estado = 'enviando' and x.reclamado_at < now() - interval '2 minutes'))
                     and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_wa_salida_resolver(p_id uuid, p_ok boolean, p_wamid text, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.cc_wa_salida;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_wa_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_wamid, '')), '') is not null then
    update public.cc_wa_salida set estado = 'enviado', wamid = p_wamid, enviado_at = now(), error = null where id = p_id;
    insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (p_wamid, s.wa_id, s.conversation_id, s.message_id, 'out') on conflict do nothing;
  else
    update public.cc_wa_salida set estado = case when s.intentos >= 5 then 'fallido' else 'pendiente' end, error = left(coalesce(p_error, 'sin detalle'), 300) where id = p_id;
  end if;
end;
$function$
;

drop function if exists public._cc_canal_retener_pendientes();
drop function if exists public._cc_detalle_envio(text);
drop function if exists public._cc_clase_envio(text);
drop function if exists public._cc_aviso_canal_permitido(text, text);
drop function if exists public._cc_canal_envio_habilitado(text, boolean);
drop table if exists public.cc_salida_decisiones;
drop index if exists public.ix_cc_wa_salida_revision;
drop index if exists public.ix_cc_meta_salida_revision;
alter table public.cc_wa_salida drop constraint ck_wa_salida_descartado_decidido, drop constraint cc_wa_salida_estado_check,
  drop column retenido_at, drop column incierto_at, drop column resultado, drop column decidido_at, drop column decidido_por, drop column decision_motivo;
alter table public.cc_wa_salida add constraint cc_wa_salida_estado_check check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana'));
alter table public.cc_meta_salida drop constraint ck_meta_salida_descartado_decidido, drop constraint cc_meta_salida_estado_check,
  drop column retenido_at, drop column incierto_at, drop column resultado, drop column decidido_at, drop column decidido_por, drop column decision_motivo;
alter table public.cc_meta_salida add constraint cc_meta_salida_estado_check check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana'));

do $post$ begin
  if md5(pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) <> 'b9a9a49dee1824dff66a300f23719afb'
     or md5(pg_get_functiondef('public._cc_meta_encolar()'::regprocedure)) <> '24d3218f716f88c73629cad1db0dbced'
     or md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure)) <> '028f05722b9265233963494ef6f75d9c'
     or md5(pg_get_functiondef('public.cc_meta_salida_reclamar(integer)'::regprocedure)) <> '07d343bc5ab54bff5fe2a15eff215c0f'
     or md5(pg_get_functiondef('public.cc_wa_salida_resolver(uuid,boolean,text,text)'::regprocedure)) <> '6c0551870b9aeaacba853a2ee5aa4220'
     or md5(pg_get_functiondef('public.cc_meta_salida_resolver(uuid,boolean,text,text)'::regprocedure)) <> 'cb3b825798d8ea1addd2968ceaa21558' then
    raise exception 'R4-B2-2 down: la cola no quedó idéntica a producción';
  end if;
end $post$;
