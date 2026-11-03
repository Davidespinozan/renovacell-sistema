-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PLANTILLAS DE WHATSAPP DESDE EL CHAT (3 nov 2026, dueño: "¿cómo le hacen la lucha de venderles si no pueden hablarle al
-- cliente…? ocupamos hablarles para decirles que ya pueden acceder a nuestra app o para prospectarlos").
--   Regla de Meta: fuera de las 24 h desde el último mensaje del cliente solo se le puede mandar una PLANTILLA aprobada;
--   cuando contesta, se abren otras 24 h. Hasta hoy solo las invitaciones masivas sabían mandar plantillas.
--   · cc_wa_plantillas       las plantillas que Renovacell dio de alta en WhatsApp Manager (nombre exacto de Meta, idioma,
--                            texto con {{1}}…, qué va en cada variable). Nacen APAGADAS: Dirección las enciende cuando
--                            Meta las aprueba.
--   · cc_wa_plantilla_enviar el vendedor responsable (o Dirección) la manda desde la conversación: solo si la ventana
--                            está cerrada, una por contacto cada 24 h. Queda como mensaje de la conversación ('tpl:') y
--                            sale por la MISMA cola de WhatsApp (estados, reintentos, pausa), con el formato de plantilla.
--   · _cc_wa_encolar         una plantilla no queda "fuera de ventana" (Meta sí la permite).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_plantillas') is not null then raise exception 'WA-PLANTILLAS: ya aplicada'; end if;
  if to_regprocedure('public.cc_retomar_conversacion(uuid)') is null or to_regprocedure('public.cc_tomar_conversacion(uuid,text)') is null
     or to_regprocedure('public._cc_wa_encolar()') is null or to_regprocedure('public._cc_wa_contacto_de(uuid)') is null then
    raise exception 'WA-PLANTILLAS: faltan MIS-CONVERSACIONES, la toma de Dirección o la cola de WhatsApp'; end if;
  if position('v_estado := case when not (k.ultimo_entrante_at > now() - interval ''24 hours'') or k.ultimo_entrante_at is null then ''fuera_ventana''' in pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) = 0 then
    raise exception 'WA-PLANTILLAS: _cc_wa_encolar cambió; revisar el parche'; end if;
end $pre$;

create table public.cc_wa_plantillas (
  nombre     text primary key check (nombre ~ '^[a-z0-9_]+$' and length(nombre) <= 512),
  etiqueta   text not null,
  idioma     text not null default 'es_MX',
  categoria  text not null check (categoria in ('MARKETING', 'UTILITY')),
  cuerpo     text not null,
  variables  text[] not null default '{}' check (variables <@ array['cliente', 'vendedor', 'promocion', 'promocion_hasta']),
  botones    text[] not null default '{}',   -- respuestas rápidas tal como se dan de alta en Meta (al tocarlas, se reabren las 24 h)
  activa     boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
comment on table public.cc_wa_plantillas is 'WA-PLANTILLAS · plantillas aprobadas en WhatsApp Manager; activa = Meta ya la aprobó (lo marca Dirección).';
-- Textos revisados con el dueño (3 nov): de usted, sin "asesor(a)", con respuestas rápidas y, en promociones, la baja.
insert into public.cc_wa_plantillas (nombre, etiqueta, categoria, cuerpo, variables, botones) values
  ('seguimiento_vendedor', 'Seguimiento', 'MARKETING', 'Hola {{1}}, le saluda {{2}} de Renovacell. Quedo a sus órdenes para cotizaciones, existencias o su próximo pedido. ¿Le puedo ayudar en algo esta semana?', array['cliente', 'vendedor'], array['Sí, por favor', 'Ahora no']),
  ('acceso_portal', 'Acceso a la app', 'UTILITY', 'Hola {{1}}, su cuenta en Renovacell está lista. Desde ahí puede ver sus precios, hacer pedidos y seguir sus envíos. ¿Le envío su enlace de acceso?', array['cliente'], array['Sí, envíenmelo']),
  ('promocion_vigente', 'Promoción', 'MARKETING', 'Hola {{1}}, tenemos {{2}} con precio especial hasta el {{3}}. ¿Le aparto piezas?', array['cliente', 'promocion', 'promocion_hasta'], array['Me interesa', 'Detener promociones']);

-- Quien toca "Detener promociones" ya no recibe plantillas de Marketing (protege la calidad del número). Sí puede
-- seguir recibiendo las de Utilidad (su acceso) y, desde luego, la plática normal cuando él escriba.
create table public.cc_wa_bajas_promo (
  wa_id      text primary key,
  created_at timestamptz not null default now()
);
alter table public.cc_wa_bajas_promo enable row level security;
revoke all on public.cc_wa_bajas_promo from public, anon, authenticated;
create function public._cc_wa_baja_promo_tr() returns trigger language plpgsql security definer set search_path = public as
$$
declare v_wa text;
begin
  if lower(btrim(coalesce(new.content, ''))) not in ('detener promociones', 'stop promotions') then return new; end if;
  v_wa := (public._cc_wa_contacto_de(new.conversation_id)).wa_id;
  if v_wa is not null then insert into public.cc_wa_bajas_promo (wa_id) values (v_wa) on conflict do nothing; end if;
  return new;
exception when others then return new;
end;
$$;
create trigger cc_wa_baja_promo after insert on public.cc_messages for each row when (new.actor_type = 'visitor' or new.actor_type = 'doctor') execute function public._cc_wa_baja_promo_tr();

create table public.cc_wa_plantilla_envios (
  message_id  uuid primary key references public.cc_messages(id) on delete cascade,
  plantilla   text not null references public.cc_wa_plantillas(nombre),
  idioma      text not null,
  parametros  text[] not null,
  wa_id       text not null,
  enviado_por uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index ix_cc_wa_plantilla_envios_wa on public.cc_wa_plantilla_envios (wa_id, created_at);
alter table public.cc_wa_plantillas enable row level security;
alter table public.cc_wa_plantilla_envios enable row level security;
revoke all on public.cc_wa_plantillas, public.cc_wa_plantilla_envios from public, anon, authenticated;
grant select on public.cc_wa_plantilla_envios to service_role;

-- Las plantillas (todas para Dirección; las encendidas para quien atiende conversaciones).
create function public.cc_wa_plantillas_lista() returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or not public._cc_puede_atender(auth.uid()) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'etiqueta', p.etiqueta, 'categoria', p.categoria, 'cuerpo', p.cuerpo, 'variables', p.variables, 'botones', p.botones, 'activa', p.activa) order by p.etiqueta)
                     from public.cc_wa_plantillas p where p.activa or public._cc_es_admin()), '[]'::jsonb);
end;
$$;

create function public.cc_wa_plantilla_activar(p_nombre text, p_activa boolean) returns jsonb language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_plantillas set activa = coalesce(p_activa, false), updated_at = now(), updated_by = auth.uid() where nombre = p_nombre;
  if not found then raise exception 'PLANTILLA_INEXISTENTE' using errcode = 'check_violation'; end if;
  return jsonb_build_object('nombre', p_nombre, 'activa', coalesce(p_activa, false));
end;
$$;

-- Mandarla desde la conversación.
create function public.cc_wa_plantilla_enviar(p_conv uuid, p_plantilla text, p_promocion uuid default null, p_client_id text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); c record; k public.cc_wa_contactos; t public.cc_wa_plantillas; v_pnom text; v_phasta date; v_params text[] := '{}'; v_var text; v_texto text; i int;
        v_cliente text; v_yo text; v_actor text; r jsonb; v_cid text := 'tpl:' || coalesce(nullif(regexp_replace(coalesce(p_client_id, ''), '[^A-Za-z0-9:_-]', '', 'g'), ''), gen_random_uuid()::text);
begin
  if v_uid is null or not public._cc_puede_atender(v_uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_actor := case when public._cc_es_admin() then 'admin' else 'seller' end;
  if v_actor = 'seller' and public._cc_vendedor_conv(p_conv) is distinct from v_uid and c.seller_profile_id is distinct from v_uid then
    raise exception 'NO_AUTORIZADO: no es tu cliente' using errcode = 'insufficient_privilege'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  k := public._cc_wa_contacto_de(p_conv);
  if k.wa_id is null then raise exception 'PLANTILLA_SIN_WHATSAPP: esta conversación no es de WhatsApp' using errcode = 'check_violation'; end if;
  select * into t from public.cc_wa_plantillas where nombre = p_plantilla and activa;
  if not found then raise exception 'PLANTILLA_INEXISTENTE: esa plantilla no está activa' using errcode = 'check_violation'; end if;
  if k.ultimo_entrante_at > now() - interval '24 hours' then raise exception 'PLANTILLA_VENTANA_ABIERTA: escribió hace menos de 24 horas; escríbele normal' using errcode = 'check_violation'; end if;
  if t.categoria = 'MARKETING' and exists (select 1 from public.cc_wa_bajas_promo b where b.wa_id = k.wa_id) then
    raise exception 'PLANTILLA_BAJA: este cliente pidió no recibir promociones; háblale por teléfono o espera a que escriba' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_wa_plantilla:' || k.wa_id));
  if exists (select 1 from public.cc_wa_plantilla_envios e where e.wa_id = k.wa_id and e.created_at > now() - interval '24 hours') then
    raise exception 'PLANTILLA_RECIENTE: ya se le mandó una plantilla en las últimas 24 horas; espera a que conteste' using errcode = 'check_violation'; end if;
  -- Variables.
  v_cliente := coalesce(nullif(split_part(btrim(coalesce(
                  (select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id),
                  (select cu.full_name from public.customers cu where cu.id = c.customer_id),
                  (select r.nombre from public.cc_prerregistros r where r.visitor_id = c.visitor_id),
                  k.nombre, '')), ' ', 1), ''), 'doctor(a)');
  v_cliente := initcap(lower(v_cliente));
  select split_part(coalesce(nullif(btrim(p.full_name), ''), 'tu asesor'), ' ', 1) into v_yo from public.profiles p where p.id = v_uid;
  if 'promocion' = any (t.variables) then
    select pr.nombre, pr.hasta into v_pnom, v_phasta from public.promociones pr where pr.id = p_promocion and pr.activa and public._promo_hoy() between pr.desde and pr.hasta;
    if not found then raise exception 'PLANTILLA_PROMOCION: elige una promoción vigente' using errcode = 'check_violation'; end if;
  end if;
  foreach v_var in array t.variables loop
    v_params := v_params || case v_var when 'cliente' then v_cliente when 'vendedor' then v_yo when 'promocion' then v_pnom
                                       when 'promocion_hasta' then extract(day from v_phasta)::int || ' de ' || (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_phasta)::int] end;
  end loop;
  v_texto := t.cuerpo;
  for i in 1 .. coalesce(array_length(v_params, 1), 0) loop v_texto := replace(v_texto, '{{' || i || '}}', v_params[i]); end loop;
  -- Quien la manda queda atendiendo: el vendedor la retoma; Dirección la toma.
  if not (c.modo = 'human_active' and ((v_actor = 'seller' and c.seller_profile_id = v_uid and c.tomada_por is null) or (v_actor = 'admin' and c.tomada_por = v_uid))) then
    if v_actor = 'seller' then perform public.cc_retomar_conversacion(p_conv); else perform public.cc_tomar_conversacion(p_conv, 'Plantilla de WhatsApp'); end if;
  end if;
  r := public.cc_enviar_mensaje(p_conv, v_actor, null, v_uid, v_cid, v_texto);
  insert into public.cc_wa_plantilla_envios (message_id, plantilla, idioma, parametros, wa_id, enviado_por)
  values ((r ->> 'id')::uuid, t.nombre, t.idioma, v_params, k.wa_id, v_uid) on conflict (message_id) do nothing;
  return jsonb_build_object('message_id', r ->> 'id', 'texto', v_texto, 'plantilla', t.nombre, 'idempotente', (r ->> 'idempotente')::boolean);
end;
$$;

-- Una plantilla no queda "fuera de ventana": Meta sí la deja salir.
do $patch$
declare d text := pg_get_functiondef('public._cc_wa_encolar()'::regprocedure);
begin
  d := replace(d, 'v_estado := case when not (k.ultimo_entrante_at > now() - interval ''24 hours'') or k.ultimo_entrante_at is null then ''fuera_ventana''',
                  'v_estado := case when coalesce(new.client_message_id, '''') not like ''tpl:%'' and (not (k.ultimo_entrante_at > now() - interval ''24 hours'') or k.ultimo_entrante_at is null) then ''fuera_ventana''');
  execute d;
end $patch$;

revoke all on function public._cc_wa_baja_promo_tr() from public, anon, authenticated;
revoke all on function public.cc_wa_plantillas_lista(), public.cc_wa_plantilla_activar(text, boolean), public.cc_wa_plantilla_enviar(uuid, text, uuid, text) from public, anon;
grant execute on function public.cc_wa_plantillas_lista(), public.cc_wa_plantilla_activar(text, boolean), public.cc_wa_plantilla_enviar(uuid, text, uuid, text) to authenticated;

do $post$ begin
  if position('tpl:%' in pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) = 0 or (select count(*) from public.cc_wa_plantillas where activa) <> 0 then
    raise exception 'WA-PLANTILLAS: no quedó aplicada'; end if;
end $post$;
