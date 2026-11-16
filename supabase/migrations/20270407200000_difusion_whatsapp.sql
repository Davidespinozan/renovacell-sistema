-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DIFUSIONES POR WHATSAPP (15 nov 2026, dueño: «hace falta que la lista de difusión funcione en WhatsApp también»).
-- Sobre el bloque D (20270217: correo + chat del portal) y WA-PLANTILLAS (20270403/04).
--   Regla de Meta: a quien no escribió en las últimas 24 h solo le llega una PLANTILLA aprobada. La difusión sale con la
--   plantilla de sistema `difusion_vendedor` («Hola {{cliente}}, le comparte {{vendedor}} de Renovacell: {{mensaje}} …»);
--   el mensaje de la vendedora va en el dato {{mensaje}} (en un renglón: Meta no acepta saltos de línea en un dato).
--   · cc_difusion_envios canal 'whatsapp': un renglón por cliente con su celular (10 dígitos) y estado
--     pendiente → enviando → enviado | fallido | incierto, u omitido (sin_whatsapp, dado_de_baja, telefono_repetido, reciente).
--   · Salida: cada minuto, solo en horario de atención, hasta `limite_diario` (250) por día entre todas las difusiones,
--     la base despierta a la Edge `difusion-wa` (x-cron-secret). Si Meta rechaza por el canal (plantilla no aprobada,
--     límite, token), se pausa 30 min y lo pendiente se queda en cola: la lista nunca se quema.
--   · Baja: quien tocó «Detener promociones» (cc_wa_bajas_promo) no recibe. Un mismo celular, una vez por difusión y
--     una vez cada 24 h entre difusiones.
--   · Respuesta: cuando ese celular contesta por WhatsApp (30 días), su conversación queda ligada al CLIENTE al que se le
--     mandó → le llega a la vendedora de su cartera (no al reparto al azar) y se le avisa «contestó tu difusión».
--     La ligadura NO da acceso a nada al que escribe (la IA sigue tratándolo como visitante; eso solo lo da el vínculo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_difusion_wa_estado') is not null then raise exception 'DIFUSION-WA: ya aplicada'; end if;
  if to_regprocedure('public.difusion_enviar(text,text,text,text,jsonb,text[])') is null or to_regclass('public.cc_wa_bajas_promo') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_wa_plantillas' and column_name = 'estado_meta')
     or to_regprocedure('public._cc_horario_estado(timestamptz)') is null or to_regprocedure('public._cc_wa_contacto_de(uuid)') is null then
    raise exception 'DIFUSION-WA: faltan el bloque D, WA-PLANTILLAS(-META), el horario o los contactos de WhatsApp'; end if;
  if position('select * into t from public.cc_wa_plantillas where nombre = p_plantilla and activa;' in pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure)) = 0
     or position('<@ array[''cliente'', ''vendedor'', ''promocion'', ''promocion_hasta'']' in pg_get_functiondef('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])'::regprocedure)) = 0 then
    raise exception 'DIFUSION-WA: cambiaron las funciones de plantillas; revisar los parches'; end if;
end $pre$;

-- ── Dato nuevo de plantilla: {{mensaje}} (solo lo llena una difusión) ──────────────────────────────
alter table public.cc_wa_plantillas drop constraint cc_wa_plantillas_variables_check;
alter table public.cc_wa_plantillas add constraint cc_wa_plantillas_variables_check
  check (variables <@ array['cliente', 'vendedor', 'promocion', 'promocion_hasta', 'mensaje']);
do $patch$
declare d text := pg_get_functiondef('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])'::regprocedure);
begin
  execute replace(d, '<@ array[''cliente'', ''vendedor'', ''promocion'', ''promocion_hasta'']', '<@ array[''cliente'', ''vendedor'', ''promocion'', ''promocion_hasta'', ''mensaje'']');
end $patch$;
-- Desde una conversación no se puede llenar {{mensaje}}: esas plantillas no se ofrecen ahí.
do $patch$
declare d text := pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure);
begin
  execute replace(d, 'select * into t from public.cc_wa_plantillas where nombre = p_plantilla and activa;',
                     'select * into t from public.cc_wa_plantillas where nombre = p_plantilla and activa and not (''mensaje'' = any (variables));');
end $patch$;

insert into public.cc_wa_plantillas (nombre, etiqueta, categoria, cuerpo, variables, botones) values
  ('difusion_vendedor', 'Difusión', 'MARKETING',
   'Hola {{1}}, le comparte {{2}} de Renovacell: {{3}} Si le interesa, responda a este mensaje y con gusto le atendemos.',
   array['cliente', 'vendedor', 'mensaje'], array['Me interesa', 'Detener promociones'])
on conflict (nombre) do nothing;

-- ── Estado de la salida (una fila) ──────────────────────────────────────────────────────────────────
create table public.cc_difusion_wa_estado (
  id            boolean primary key default true check (id),
  plantilla     text not null default 'difusion_vendedor' references public.cc_wa_plantillas(nombre),
  limite_diario integer not null default 250 check (limite_diario between 1 and 10000),
  pausada_hasta timestamptz,
  nota          text check (nota is null or length(nota) <= 300),
  updated_at    timestamptz not null default now()
);
insert into public.cc_difusion_wa_estado (id) values (true);
alter table public.cc_difusion_wa_estado enable row level security;
revoke all on public.cc_difusion_wa_estado from public, anon, authenticated;

-- ── Difusiones y envíos con WhatsApp ────────────────────────────────────────────────────────────────
alter table public.cc_difusiones add column n_whatsapp integer not null default 0, add column n_sin_whatsapp integer not null default 0;
alter table public.cc_difusion_envios drop constraint cc_difusion_envios_canal_check;
alter table public.cc_difusion_envios add constraint cc_difusion_envios_canal_check check (canal in ('correo', 'chat', 'whatsapp'));
alter table public.cc_difusion_envios drop constraint cc_difusion_envios_estado_check;
alter table public.cc_difusion_envios add constraint cc_difusion_envios_estado_check check (estado in (
  'encolado', 'entregado', 'sin_correo', 'dado_de_baja', 'sin_conversacion',
  'pendiente', 'enviando', 'enviado', 'fallido', 'incierto', 'sin_whatsapp', 'telefono_repetido', 'reciente'));
alter table public.cc_difusion_envios
  add column destino      text check (destino is null or destino ~ '^[0-9]{10}$'),
  add column parametros   text[],
  add column reclamado_at timestamptz,
  add column enviado_at   timestamptz,
  add column proveedor_id text check (proveedor_id is null or length(proveedor_id) <= 200),
  add column error        text check (error is null or length(error) <= 300);
create index ix_dif_envios_wa_cola on public.cc_difusion_envios (estado, id) where canal = 'whatsapp' and estado in ('pendiente', 'enviando');
create index ix_dif_envios_wa_destino on public.cc_difusion_envios (destino, enviado_at) where canal = 'whatsapp' and destino is not null;

-- Celular del cliente en 10 dígitos (México): el principal activo de customer_phones o el de la ficha.
create function public._difwa_tel(p_customer uuid) returns text language sql stable security definer set search_path = public as
$$
  select case when length(d) = 10 then d when length(d) = 12 and d like '52%' then right(d, 10) when length(d) = 13 and d like '521%' then right(d, 10) end
    from (select regexp_replace(coalesce(
            (select t.numero from public.customer_phones t where t.customer_id = p_customer and t.activo and nullif(btrim(t.numero), '') is not null order by t.es_principal desc, t.created_at limit 1),
            (select c.phone from public.customers c where c.id = p_customer), ''), '\D', '', 'g') d) x
$$;

-- Nombre para el saludo: clínica completa; doctor, su primer nombre sin «Dr./Dra.».
create function public._difwa_saludo(c public.customers) returns text language sql stable security definer set search_path = public as
$$
  select left(coalesce(nullif(case when c.tipo_cliente = 'clinica' then initcap(lower(btrim(c.full_name)))
                                   else initcap(lower(split_part(regexp_replace(btrim(coalesce(c.full_name, '')), '^(dra?\.?|doctora?|lic\.?|q\.?f\.?b\.?)\s+', '', 'i'), ' ', 1))) end, ''), 'doctor(a)'), 60)
$$;

-- El mensaje en un renglón (Meta no acepta saltos de línea ni 4+ espacios en un dato): título, texto, enlace, imagen.
create function public._difwa_mensaje(p_titulo text, p_texto text, p_enlace text, p_imagen text) returns text language sql immutable set search_path = public as
$$
  select left(regexp_replace(btrim(
           '*' || btrim(coalesce(p_titulo, '')) || '* — ' || btrim(coalesce(p_texto, ''))
           || case when nullif(btrim(coalesce(p_enlace, '')), '') is not null then ' ' || btrim(p_enlace) else '' end
           || case when nullif(btrim(coalesce(p_imagen, '')), '') is not null then ' Imagen: ' || btrim(p_imagen) else '' end), '\s+', ' ', 'g'), 800)
$$;

create function public._difwa_plantilla_lista() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.cc_difusion_wa_estado e join public.cc_wa_plantillas p on p.nombre = e.plantilla where p.activa) $$;

-- ── Vista previa con WhatsApp ───────────────────────────────────────────────────────────────────────
create or replace function public.difusion_previa(p_audiencia jsonb) returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  return (select jsonb_build_object('total', count(*),
            'con_correo', count(*) filter (where public._dif_correo_de(c) is not null and c.difusiones_baja_at is null),
            'dados_de_baja', count(*) filter (where c.difusiones_baja_at is not null),
            'sin_correo', count(*) filter (where public._dif_correo_de(c) is null),
            'con_cuenta', count(*) filter (where c.profile_id is not null),
            'con_whatsapp', count(distinct x.tel) filter (where x.tel is not null and not x.baja),
            'sin_whatsapp', count(*) filter (where x.tel is null),
            'whatsapp_baja', count(*) filter (where x.tel is not null and x.baja),
            'whatsapp_lista', public._difwa_plantilla_lista(),
            'whatsapp_limite', (select limite_diario from public.cc_difusion_wa_estado))
    from public.customers c
    cross join lateral (select t.tel, t.tel is not null and exists (select 1 from public.cc_wa_bajas_promo b where right(b.wa_id, 10) = t.tel) baja
                          from (select public._difwa_tel(c.id) tel) t) x
   where c.id in (select public._dif_audiencia(p_audiencia)));
end;
$$;

-- ── Mandar (correo y chat sin cambios; WhatsApp a la cola) ──────────────────────────────────────────
create or replace function public.difusion_enviar(p_titulo text, p_texto text, p_enlace text, p_imagen text, p_audiencia jsonb, p_canales text[]) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; d public.cc_difusiones; c public.customers; v_mail text; v_conv uuid; v_trusted text := coalesce(current_setting('app.trusted', true), '');
        v_correo boolean := 'correo' = any (p_canales); v_chat boolean := 'chat' = any (p_canales); v_wa boolean := 'whatsapp' = any (p_canales);
        v_contenido text; v_tel text; v_mensaje text; v_yo text; v_tels text[] := '{}';
begin
  select * into a from public._dif_alcance();
  if not (v_correo or v_chat or v_wa) then raise exception 'DATO_INVALIDO:canales'; end if;
  if v_wa and not public._difwa_plantilla_lista() then
    raise exception 'WA_SIN_PLANTILLA: la plantilla de difusión de WhatsApp todavía no la aprueba Meta' using errcode = 'check_violation'; end if;
  if (select count(*) from public.cc_difusiones where seller_profile_id = a.uid and created_at >= (public.hoy_local()::timestamp at time zone 'America/Mazatlan')) >= 5 then
    raise exception 'LIMITE_DIARIO: ya mandaste 5 difusiones hoy'; end if;
  insert into public.cc_difusiones (seller_profile_id, titulo, texto, enlace, imagen_url, audiencia, canales)
  values (a.uid, btrim(p_titulo), btrim(p_texto), nullif(btrim(coalesce(p_enlace, '')), ''), nullif(btrim(coalesce(p_imagen, '')), ''), p_audiencia, p_canales)
  returning * into d;
  v_contenido := '[difusion:' || d.id || ']' || chr(10) || d.titulo || chr(10) || d.texto
    || case when d.enlace is not null then chr(10) || '[enlace] ' || d.enlace else '' end
    || case when d.imagen_url is not null then chr(10) || '[imagen] ' || d.imagen_url else '' end;
  v_mensaje := public._difwa_mensaje(d.titulo, d.texto, d.enlace, d.imagen_url);
  select left(initcap(lower(split_part(coalesce(nullif(btrim(p.full_name), ''), 'Renovacell'), ' ', 1))), 40) into v_yo from public.profiles p where p.id = a.uid;
  perform set_config('app.trusted', 'on', true);
  for c in select cu.* from public.customers cu where cu.id in (select public._dif_audiencia(p_audiencia)) order by cu.full_name loop
    d.n_destinatarios := d.n_destinatarios + 1;
    if v_correo then
      v_mail := public._dif_correo_de(c);
      if c.difusiones_baja_at is not null then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, 'correo', 'dado_de_baja'); d.n_baja := d.n_baja + 1;
      elsif v_mail is null or v_mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, 'correo', 'sin_correo'); d.n_sin_correo := d.n_sin_correo + 1;
      else
        insert into public.comm_outbox (event_key, plantilla, customer_id, profile_id, to_address, to_name, payload, status)
        values ('difusion:' || d.id || ':' || c.id, 'difusion', c.id, c.profile_id, v_mail, c.full_name, public._dif_payload(d, c), 'pendiente')
        on conflict (event_key) do nothing;
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, 'correo', 'encolado'); d.n_correo := d.n_correo + 1;
      end if;
    end if;
    if v_chat and c.profile_id is not null then
      begin
        v_conv := (public.cc_abrir_conversacion(null, c.profile_id) ->> 'conversation_id')::uuid;
        perform public.cc_enviar_mensaje(v_conv, 'system', null, null, 'difusion:' || d.id, v_contenido);
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, 'chat', 'entregado'); d.n_chat := d.n_chat + 1;
      exception when others then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado, detalle) values (d.id, c.id, 'chat', 'sin_conversacion', left(sqlerrm, 200));
      end;
    end if;
    if v_wa then
      v_tel := public._difwa_tel(c.id);
      if v_tel is null then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado) values (d.id, c.id, 'whatsapp', 'sin_whatsapp'); d.n_sin_whatsapp := d.n_sin_whatsapp + 1;
      elsif exists (select 1 from public.cc_wa_bajas_promo b where right(b.wa_id, 10) = v_tel) then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado, destino) values (d.id, c.id, 'whatsapp', 'dado_de_baja', v_tel);
      elsif v_tel = any (v_tels) then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado, destino) values (d.id, c.id, 'whatsapp', 'telefono_repetido', v_tel);
      elsif exists (select 1 from public.cc_difusion_envios e where e.canal = 'whatsapp' and e.destino = v_tel
                      and (e.estado in ('pendiente', 'enviando') or (e.estado = 'enviado' and e.enviado_at > now() - interval '24 hours'))) then
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado, destino) values (d.id, c.id, 'whatsapp', 'reciente', v_tel);
      else
        v_tels := v_tels || v_tel;
        insert into public.cc_difusion_envios (difusion_id, customer_id, canal, estado, destino, parametros)
        values (d.id, c.id, 'whatsapp', 'pendiente', v_tel, array[public._difwa_saludo(c), v_yo, v_mensaje]);
        d.n_whatsapp := d.n_whatsapp + 1;
      end if;
    end if;
  end loop;
  perform set_config('app.trusted', v_trusted, true);
  if d.n_destinatarios = 0 then raise exception 'AUDIENCIA_VACIA: no hay clientes en esa audiencia'; end if;
  update public.cc_difusiones set n_destinatarios = d.n_destinatarios, n_correo = d.n_correo, n_chat = d.n_chat, n_sin_correo = d.n_sin_correo, n_baja = d.n_baja,
         n_whatsapp = d.n_whatsapp, n_sin_whatsapp = d.n_sin_whatsapp where id = d.id;
  return jsonb_build_object('id', d.id, 'destinatarios', d.n_destinatarios, 'correo', d.n_correo, 'chat', d.n_chat, 'sin_correo', d.n_sin_correo, 'dados_de_baja', d.n_baja,
                            'whatsapp', d.n_whatsapp, 'sin_whatsapp', d.n_sin_whatsapp, 'whatsapp_limite', (select limite_diario from public.cc_difusion_wa_estado));
end;
$$;

create or replace function public.mis_difusiones() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._dif_alcance();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'texto', d.texto, 'enlace', d.enlace, 'imagen_url', d.imagen_url, 'audiencia', d.audiencia,
            'canales', d.canales, 'destinatarios', d.n_destinatarios, 'correo', d.n_correo, 'chat', d.n_chat, 'sin_correo', d.n_sin_correo, 'dados_de_baja', d.n_baja,
            'whatsapp', d.n_whatsapp, 'sin_whatsapp', d.n_sin_whatsapp,
            'whatsapp_enviados', (select count(*) from public.cc_difusion_envios e where e.difusion_id = d.id and e.canal = 'whatsapp' and e.estado = 'enviado'),
            'whatsapp_pendientes', (select count(*) from public.cc_difusion_envios e where e.difusion_id = d.id and e.canal = 'whatsapp' and e.estado in ('pendiente', 'enviando')),
            'whatsapp_fallidos', (select count(*) from public.cc_difusion_envios e where e.difusion_id = d.id and e.canal = 'whatsapp' and e.estado in ('fallido', 'incierto')),
            'whatsapp_respuestas', (select count(*) from public.cc_difusion_envios e where e.difusion_id = d.id and e.canal = 'whatsapp' and e.detalle = 'respondio'),
            'whatsapp_nota', case when 'whatsapp' = any (d.canales) then (select case when s.pausada_hasta > now() then s.nota end from public.cc_difusion_wa_estado s) end,
            'creada', d.created_at, 'es_mia', d.seller_profile_id = a.uid, 'vendedor', public._cc_nombre_personal(d.seller_profile_id),
            'lista', (select e.nombre from public.cc_etiquetas e where e.id = (d.audiencia ->> 'etiqueta_id')::uuid)) order by d.created_at desc)
    from (select * from public.cc_difusiones where seller_profile_id = a.uid or a.todos order by created_at desc limit 50) d), '[]'::jsonb);
end;
$$;

-- ── Servidor: reclamar un lote y asentar ────────────────────────────────────────────────────────────
create function public._difwa_reclamar(p_lote integer default 20)
  returns table (envio_id bigint, destino text, plantilla text, idioma text, parametros text[])
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_difusion_wa_estado; t public.cc_wa_plantillas; hor jsonb := public._cc_horario_estado(now()); v_zona text; v_hoy int; v_cupo int; e record;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  -- lo reclamado y nunca asentado (la Edge murió a medio lote) no se reenvía: queda sin confirmar
  update public.cc_difusion_envios set estado = 'incierto', error = 'sin confirmación del envío'
   where canal = 'whatsapp' and estado = 'enviando' and reclamado_at < now() - interval '10 minutes';
  select * into s from public.cc_difusion_wa_estado for update;
  if s.pausada_hasta > now() or not coalesce((hor ->> 'abierto')::boolean, false) then return; end if;
  select * into t from public.cc_wa_plantillas where nombre = s.plantilla and activa;
  if not found then return; end if;
  v_zona := coalesce(hor ->> 'zona', 'America/Mazatlan');
  select count(*) into v_hoy from public.cc_difusion_envios
   where canal = 'whatsapp' and reclamado_at is not null and (reclamado_at at time zone v_zona)::date = (now() at time zone v_zona)::date;
  v_cupo := least(greatest(coalesce(p_lote, 20), 1), 50, s.limite_diario - v_hoy);
  if v_cupo <= 0 then return; end if;
  for e in select x.* from public.cc_difusion_envios x where x.canal = 'whatsapp' and x.estado = 'pendiente' order by x.id limit v_cupo for update skip locked loop
    -- se dio de baja después de encolar: no sale
    if exists (select 1 from public.cc_wa_bajas_promo b where right(b.wa_id, 10) = e.destino) then
      update public.cc_difusion_envios set estado = 'dado_de_baja' where id = e.id; continue;
    end if;
    update public.cc_difusion_envios set estado = 'enviando', reclamado_at = now() where id = e.id;
    envio_id := e.id; destino := e.destino; plantilla := t.nombre; idioma := t.idioma; parametros := e.parametros;
    return next;
  end loop;
end;
$$;

create function public._difwa_resolver(p_envio bigint, p_resultado text, p_proveedor_id text default null, p_error text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare e public.cc_difusion_envios;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.cc_difusion_envios where id = p_envio and canal = 'whatsapp' for update;
  if not found or e.estado <> 'enviando' then return; end if;
  if p_resultado = 'enviado' then
    update public.cc_difusion_envios set estado = 'enviado', enviado_at = now(), proveedor_id = left(p_proveedor_id, 200), error = null where id = e.id;
  elsif p_resultado = 'incierto' then
    update public.cc_difusion_envios set estado = 'incierto', error = left(coalesce(p_error, 'sin confirmación del envío'), 300) where id = e.id;
  elsif p_resultado = 'retener' then   -- problema del canal, no del cliente: vuelve a la cola y la salida se pausa 30 min
    update public.cc_difusion_envios set estado = 'pendiente', reclamado_at = null, error = null where id = e.id;
    update public.cc_difusion_wa_estado set pausada_hasta = now() + interval '30 minutes', nota = left(coalesce(p_error, 'WhatsApp rechazó el envío'), 300), updated_at = now();
  else
    update public.cc_difusion_envios set estado = 'fallido', error = left(coalesce(p_error, 'rechazado'), 300) where id = e.id;
  end if;
end;
$$;

create function public._difwa_despachar() returns text language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text;
begin
  if not exists (select 1 from public.cc_difusion_envios where canal = 'whatsapp' and estado = 'pendiente') then return 'sin_pendientes'; end if;
  if (select pausada_hasta from public.cc_difusion_wa_estado) > now() then return 'pausada'; end if;
  if not public._difwa_plantilla_lista() then return 'sin_plantilla'; end if;
  if not coalesce((public._cc_horario_estado(now()) ->> 'abierto')::boolean, false) then return 'fuera_de_horario'; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 'sin_configurar'; end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/difusion-wa',
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                        body := '{"action":"enviar"}'::jsonb, timeout_milliseconds := 55000);
  return 'despachado';
end;
$$;

-- ── La respuesta le llega a la vendedora del cliente ────────────────────────────────────────────────
create function public._difwa_respuesta_tr() returns trigger language plpgsql security definer set search_path = public as
$$
declare c record; k public.cc_wa_contactos; e record; v_seller uuid;
begin
  begin
    select id, profile_id, customer_id, visitor_id into c from public.cc_conversations where id = new.conversation_id;
    if not found or c.profile_id is not null or c.customer_id is not null or c.visitor_id is null then return new; end if;
    k := public._cc_wa_contacto_de(new.conversation_id);
    if k.wa_id is null then return new; end if;
    select x.id, x.customer_id, x.difusion_id, d.titulo, d.seller_profile_id into e
      from public.cc_difusion_envios x join public.cc_difusiones d on d.id = x.difusion_id
     where x.canal = 'whatsapp' and x.estado = 'enviado' and x.destino = right(k.wa_id, 10) and x.enviado_at > now() - interval '30 days'
     order by x.enviado_at desc limit 1;
    if not found then return new; end if;
    update public.cc_conversations set customer_id = e.customer_id, updated_at = now() where id = c.id and customer_id is null;
    update public.cc_difusion_envios set detalle = 'respondio' where id = e.id and detalle is null;
    v_seller := coalesce(public._cc_vendedor_de_cliente(e.customer_id), e.seller_profile_id);
    perform public._cc_notificar('difusion_respuesta', c.id, array[v_seller], null,
      format('%s contestó tu difusión «%s» por WhatsApp.', coalesce((select initcap(lower(full_name)) from public.customers where id = e.customer_id), 'Un cliente'), e.titulo),
      'asesorias', 'difusion_respuesta:' || c.id::text);
  exception when others then
    raise warning 'DIFUSION-WA: no se ligó la respuesta (%): el mensaje sigue', sqlerrm;
  end;
  return new;
end;
$$;
create trigger a_difusion_respuesta before insert on public.cc_messages for each row when (new.actor_type = 'visitor') execute function public._difwa_respuesta_tr();

-- ── Permisos y tarea programada ─────────────────────────────────────────────────────────────────────
alter function public._difwa_reclamar(integer) owner to postgres;
alter function public._difwa_resolver(bigint, text, text, text) owner to postgres;
alter function public._difwa_despachar() owner to postgres;
revoke all on function public._difwa_tel(uuid), public._difwa_saludo(public.customers), public._difwa_mensaje(text, text, text, text), public._difwa_plantilla_lista(),
  public._difwa_reclamar(integer), public._difwa_resolver(bigint, text, text, text), public._difwa_despachar(), public._difwa_respuesta_tr() from public, anon, authenticated;
grant execute on function public._difwa_reclamar(integer), public._difwa_resolver(bigint, text, text, text) to service_role;
revoke all on function public.difusion_previa(jsonb), public.difusion_enviar(text, text, text, text, jsonb, text[]), public.mis_difusiones() from public, anon;
grant execute on function public.difusion_previa(jsonb), public.difusion_enviar(text, text, text, text, jsonb, text[]), public.mis_difusiones() to authenticated;
select cron.schedule('renovacell-difusion-wa', '* * * * *', 'select public._difwa_despachar()');

do $post$ begin
  if not exists (select 1 from cron.job where jobname = 'renovacell-difusion-wa') then raise exception 'DIFUSION-WA: falta la tarea programada'; end if;
  if not exists (select 1 from public.cc_wa_plantillas where nombre = 'difusion_vendedor') then raise exception 'DIFUSION-WA: falta la plantilla'; end if;
  if position('''mensaje'' = any (variables)' in pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure)) = 0
     or position('''promocion_hasta'', ''mensaje'']' in pg_get_functiondef('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])'::regprocedure)) = 0 then
    raise exception 'DIFUSION-WA: parches de plantillas no aplicados'; end if;
  if has_function_privilege('authenticated', 'public._difwa_reclamar(integer)', 'execute') or has_function_privilege('authenticated', 'public._difwa_despachar()', 'execute') then
    raise exception 'DIFUSION-WA: permisos inesperados'; end if;
end $post$;
