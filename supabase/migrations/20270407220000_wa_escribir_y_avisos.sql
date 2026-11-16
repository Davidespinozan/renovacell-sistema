-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WHATSAPP A TODA LA CARTERA + PLANTILLAS NUEVAS + AVISOS DE PEDIDO (15 nov 2026, dueño: «los vendedores deben tener
-- acceso a mandar mensajes por WhatsApp a todos los clientes que ya tienen registrados… ahorita no tienen manera»).
--   1. cc_wa_escribir_cliente(cliente, plantilla, promo): la vendedora le escribe a CUALQUIER cliente de su cartera con
--      celular, aunque nunca haya escrito por WhatsApp. Se crea (o reutiliza) su contacto y su conversación, ligada al
--      cliente, y sale la plantilla aprobada por la cola de siempre. Cuando conteste, la plática sigue en Conversaciones
--      con ella. Si ya escribió en las últimas 24 h no hace falta plantilla: se abre la conversación para escribirle normal.
--   2. Datos nuevos de plantilla: folio, total, envio, enlace (los llena el sistema; no se ofrecen en el chat).
--      Plantillas nuevas (nacen sin_enviar; se mandan a Meta): invitacion_cuenta, aviso_pedido_recibido,
--      aviso_pago_confirmado, aviso_pedido_enviado, aviso_pedido_entregado, intente_llamarle.
--   3. Avisos de pedido por WhatsApp: cada correo de pedido (recibido, pago, enviado, entregado) también se encola por
--      WhatsApp al celular del cliente si su plantilla está aprobada (cc_wa_avisos). Sale con la Edge difusion-wa.
--   4. La respuesta a un aviso o a «intenté llamarle» llega a la vendedora del cliente (misma regla que la difusión).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_avisos') is not null then raise exception 'WA-ESCRIBIR: ya aplicada'; end if;
  if to_regclass('public.cc_difusion_wa_estado') is null or to_regprocedure('public._difwa_tel(uuid)') is null then raise exception 'WA-ESCRIBIR: falta DIFUSION-WA'; end if;
  if position('and activa and not (''mensaje'' = any (variables));' in pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure)) = 0
     or position('''promocion_hasta'', ''mensaje'']' in pg_get_functiondef('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])'::regprocedure)) = 0 then
    raise exception 'WA-ESCRIBIR: cambiaron las funciones de plantillas; revisar los parches'; end if;
end $pre$;

-- ── 2. Datos nuevos ─────────────────────────────────────────────────────────────────────────────────
alter table public.cc_wa_plantillas drop constraint cc_wa_plantillas_variables_check;
alter table public.cc_wa_plantillas add constraint cc_wa_plantillas_variables_check
  check (variables <@ array['cliente', 'vendedor', 'promocion', 'promocion_hasta', 'mensaje', 'folio', 'total', 'envio', 'enlace']);
do $patch$
declare d text := pg_get_functiondef('public.cc_wa_plantilla_guardar(text,text,text,text,text[],text[])'::regprocedure);
begin
  execute replace(d, '''promocion_hasta'', ''mensaje'']', '''promocion_hasta'', ''mensaje'', ''folio'', ''total'', ''envio'', ''enlace'']');
end $patch$;
do $patch$
declare d text := pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure);
begin
  execute replace(d, 'and activa and not (''mensaje'' = any (variables));', 'and activa and not (variables && array[''mensaje'', ''folio'', ''total'', ''envio'', ''enlace'']);');
end $patch$;

insert into public.cc_wa_plantillas (nombre, etiqueta, categoria, cuerpo, variables, botones) values
  ('invitacion_cuenta', 'Invitación a la app', 'UTILITY',
   'Hola {{1}}, Renovacell le invita a activar su cuenta para ver sus precios, hacer pedidos y seguir sus envíos desde su celular. Su enlace personal es {{2}} y es válido por 14 días.',
   array['cliente', 'enlace'], '{}'),
  ('aviso_pedido_recibido', 'Pedido recibido', 'UTILITY',
   'Hola {{1}}, recibimos su pedido {{2}} por {{3}}. Le avisaremos por este medio cuando confirmemos su pago y cuando salga a entrega.',
   array['cliente', 'folio', 'total'], '{}'),
  ('aviso_pago_confirmado', 'Pago confirmado', 'UTILITY',
   'Hola {{1}}, confirmamos el pago de su pedido {{2}}. Ya lo estamos preparando y le avisaremos cuando salga a entrega.',
   array['cliente', 'folio'], '{}'),
  ('aviso_pedido_enviado', 'Pedido enviado', 'UTILITY',
   'Hola {{1}}, su pedido {{2}} ya va en camino {{3}}. Le avisaremos cuando se entregue.',
   array['cliente', 'folio', 'envio'], '{}'),
  ('aviso_pedido_entregado', 'Pedido entregado', 'UTILITY',
   'Hola {{1}}, su pedido {{2}} fue entregado. Gracias por su compra; si algo no llegó bien, responda a este mensaje y con gusto le atendemos.',
   array['cliente', 'folio'], '{}'),
  ('intente_llamarle', 'Intenté llamarle', 'MARKETING',
   'Hola {{1}}, le saluda {{2}} de Renovacell. Intenté llamarle hace un momento. ¿A qué hora le puedo marcar, o prefiere que platiquemos por aquí?',
   array['cliente', 'vendedor'], array['Escríbame por aquí', 'Llámeme más tarde'])
on conflict (nombre) do nothing;

-- ── 1. Escribirle por WhatsApp a un cliente de la cartera ───────────────────────────────────────────
create function public.cc_wa_escribir_cliente(p_customer uuid, p_plantilla text, p_promocion uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; cu public.customers; v_tel text; k public.cc_wa_contactos; v_hash text; v_conv uuid; r jsonb;
begin
  select * into a from public._dif_alcance();
  if not public._dif_es_mio(p_customer, a.todos, a.uid) then raise exception 'NO_AUTORIZADO: este cliente no es de tu cartera' using errcode = 'insufficient_privilege'; end if;
  select * into cu from public.customers where id = p_customer;
  v_tel := public._difwa_tel(p_customer);
  if v_tel is null then raise exception 'PLANTILLA_SIN_CELULAR: este cliente no tiene un celular de 10 dígitos en su ficha' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_wa_escribir:' || v_tel));
  -- Su contacto de WhatsApp (el que ya escribió con ese número) o uno nuevo con el formato con que llegan los de México.
  select * into k from public.cc_wa_contactos w where right(w.wa_id, 10) = v_tel order by w.ultimo_entrante_at desc nulls last, w.created_at limit 1;
  if not found then
    insert into public.cc_wa_contactos (wa_id, nombre) values ('521' || v_tel, left(initcap(lower(btrim(cu.full_name))), 120)) on conflict (wa_id) do nothing;
    select * into k from public.cc_wa_contactos where wa_id = '521' || v_tel;
  end if;
  if k.profile_id is not null then
    v_conv := (public.cc_abrir_conversacion(null, k.profile_id) ->> 'conversation_id')::uuid;
  else
    if k.visitor_hash is null then
      v_hash := encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex');
      update public.cc_wa_contactos set visitor_hash = v_hash, visitor_id = (public.cc_visitante_abrir(null, v_hash, '{}'::jsonb, null) ->> 'visitor_id')::uuid
       where wa_id = k.wa_id;
    else v_hash := k.visitor_hash; end if;
    v_conv := (public.cc_abrir_conversacion(v_hash, null) ->> 'conversation_id')::uuid;
  end if;
  -- La conversación queda ligada al cliente: le toca a su vendedora y se ve con su nombre.
  update public.cc_conversations set customer_id = p_customer, updated_at = now() where id = v_conv and customer_id is null and profile_id is null;
  if k.ultimo_entrante_at > now() - interval '24 hours' then
    return jsonb_build_object('conversation_id', v_conv, 'ventana_abierta', true);
  end if;
  r := public.cc_wa_plantilla_enviar(v_conv, p_plantilla, p_promocion, null);
  return r || jsonb_build_object('conversation_id', v_conv, 'ventana_abierta', false);
end;
$$;
revoke all on function public.cc_wa_escribir_cliente(uuid, text, uuid) from public, anon;
grant execute on function public.cc_wa_escribir_cliente(uuid, text, uuid) to authenticated;

-- ── 3. Avisos de pedido por WhatsApp ────────────────────────────────────────────────────────────────
create table public.cc_wa_avisos (
  id           bigint generated always as identity primary key,
  event_key    text not null unique,
  customer_id  uuid references public.customers(id) on delete set null,
  destino      text not null check (destino ~ '^[0-9]{10}$'),
  plantilla    text not null references public.cc_wa_plantillas(nombre),
  parametros   text[] not null,
  titulo       text not null check (length(titulo) <= 120),      -- para el aviso a la vendedora si contesta
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'incierto', 'omitido')),
  motivo       text check (motivo is null or length(motivo) <= 60),
  reclamado_at timestamptz,
  enviado_at   timestamptz,
  proveedor_id text check (proveedor_id is null or length(proveedor_id) <= 200),
  error        text check (error is null or length(error) <= 300),
  respondio_at timestamptz,
  created_at   timestamptz not null default now()
);
create index ix_cc_wa_avisos_cola on public.cc_wa_avisos (estado, id) where estado in ('pendiente', 'enviando');
create index ix_cc_wa_avisos_destino on public.cc_wa_avisos (destino, enviado_at) where estado = 'enviado';
alter table public.cc_wa_avisos enable row level security;
revoke all on public.cc_wa_avisos from public, anon, authenticated;

create function public._wa_aviso_pedido_tr() returns trigger language plpgsql security definer set search_path = public as
$$
declare v_pl text; v_cust uuid; v_tel text; v_nom text; v_params text[]; v_envio text; c public.customers;
begin
  begin
    v_pl := case new.plantilla when 'pedido_recibido' then 'aviso_pedido_recibido' when 'pago_recibido' then 'aviso_pago_confirmado'
                               when 'pedido_enviado' then 'aviso_pedido_enviado' when 'pedido_entregado' then 'aviso_pedido_entregado' end;
    if v_pl is null or new.order_id is null then return new; end if;
    if not exists (select 1 from public.cc_wa_plantillas where nombre = v_pl and activa) then return new; end if;
    v_cust := coalesce(new.customer_id, (select x.id from public.customers x where new.profile_id is not null and x.profile_id = new.profile_id limit 1));
    if v_cust is null then return new; end if;
    v_tel := public._difwa_tel(v_cust);
    if v_tel is null then return new; end if;
    select * into c from public.customers where id = v_cust;
    v_nom := public._difwa_saludo(c);
    v_envio := case when nullif(new.payload ->> 'rastreo', '') is not null
                    then 'con ' || coalesce(nullif(upper(new.payload ->> 'paqueteria'), ''), 'paquetería') || ', guía ' || (new.payload ->> 'rastreo')
                    else 'con nuestro repartidor' end;
    v_params := case v_pl
      when 'aviso_pedido_recibido' then array[v_nom, coalesce(new.payload ->> 'folio', 'su pedido'), to_char(coalesce((new.payload ->> 'total')::numeric, 0), 'FM$999,999,990.00')]
      when 'aviso_pedido_enviado' then array[v_nom, coalesce(new.payload ->> 'folio', 'su pedido'), v_envio]
      else array[v_nom, coalesce(new.payload ->> 'folio', 'su pedido')] end;
    insert into public.cc_wa_avisos (event_key, customer_id, destino, plantilla, parametros, titulo)
    values ('wa:' || new.event_key, v_cust, v_tel, v_pl, v_params, left((select etiqueta from public.cc_wa_plantillas where nombre = v_pl) || ' ' || coalesce(new.payload ->> 'folio', ''), 120))
    on conflict (event_key) do nothing;
  exception when others then
    raise warning 'WA-AVISO: no se encoló (%): el correo sigue', sqlerrm;   -- un aviso nunca tumba el pedido
  end;
  return new;
end;
$$;
create trigger wa_aviso_pedido after insert on public.comm_outbox for each row
  when (new.plantilla in ('pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado')) execute function public._wa_aviso_pedido_tr();

-- «Intenté llamarle» (y cualquier aviso de la vendedora a un cliente sin conversación) usa cc_wa_escribir_cliente: queda en
-- su conversación. Aquí solo el servidor (Edge difusion-wa) reclama y asienta los avisos del sistema.
create function public._wa_avisos_reclamar(p_lote integer default 20)
  returns table (aviso_id bigint, destino text, plantilla text, idioma text, parametros text[])
  language plpgsql security definer set search_path = public as
$$
declare e record; s public.cc_difusion_wa_estado;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_avisos set estado = 'incierto', error = 'sin confirmación del envío' where estado = 'enviando' and reclamado_at < now() - interval '10 minutes';
  update public.cc_wa_avisos set estado = 'omitido', motivo = 'vencido' where estado = 'pendiente' and created_at < now() - interval '24 hours';
  select * into s from public.cc_difusion_wa_estado;
  if s.pausada_hasta > now() then return; end if;
  for e in select x.*, t.idioma t_idioma from public.cc_wa_avisos x join public.cc_wa_plantillas t on t.nombre = x.plantilla and t.activa
            where x.estado = 'pendiente' order by x.id limit least(greatest(coalesce(p_lote, 20), 1), 50) for update of x skip locked loop
    update public.cc_wa_avisos set estado = 'enviando', reclamado_at = now() where id = e.id;
    aviso_id := e.id; destino := e.destino; plantilla := e.plantilla; idioma := e.t_idioma; parametros := e.parametros;
    return next;
  end loop;
end;
$$;

create function public._wa_avisos_resolver(p_aviso bigint, p_resultado text, p_proveedor_id text default null, p_error text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare e public.cc_wa_avisos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.cc_wa_avisos where id = p_aviso for update;
  if not found or e.estado <> 'enviando' then return; end if;
  if p_resultado = 'enviado' then
    update public.cc_wa_avisos set estado = 'enviado', enviado_at = now(), proveedor_id = left(p_proveedor_id, 200), error = null where id = e.id;
  elsif p_resultado = 'incierto' then
    update public.cc_wa_avisos set estado = 'incierto', error = left(coalesce(p_error, 'sin confirmación del envío'), 300) where id = e.id;
  elsif p_resultado = 'retener' then
    update public.cc_wa_avisos set estado = 'pendiente', reclamado_at = null where id = e.id;
    update public.cc_difusion_wa_estado set pausada_hasta = now() + interval '30 minutes', nota = left(coalesce(p_error, 'WhatsApp rechazó el envío'), 300), updated_at = now();
  else
    update public.cc_wa_avisos set estado = 'fallido', error = left(coalesce(p_error, 'rechazado'), 300) where id = e.id;
  end if;
end;
$$;

-- La tarea de cada minuto despierta a la Edge si hay avisos (a cualquier hora) o difusiones (en horario).
create or replace function public._difwa_despachar() returns text language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text; v_avisos boolean; v_dif boolean;
begin
  v_avisos := exists (select 1 from public.cc_wa_avisos where estado = 'pendiente');
  v_dif := exists (select 1 from public.cc_difusion_envios where canal = 'whatsapp' and estado = 'pendiente')
           and public._difwa_plantilla_lista() and coalesce((public._cc_horario_estado(now()) ->> 'abierto')::boolean, false);
  if not (v_avisos or v_dif) then return 'sin_pendientes'; end if;
  if (select pausada_hasta from public.cc_difusion_wa_estado) > now() then return 'pausada'; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 'sin_configurar'; end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/difusion-wa',
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                        body := '{"action":"enviar"}'::jsonb, timeout_milliseconds := 55000);
  return 'despachado';
end;
$$;

-- ── 4. La respuesta a una difusión o a un aviso le llega a la vendedora del cliente ──────────────────
create or replace function public._difwa_respuesta_tr() returns trigger language plpgsql security definer set search_path = public as
$$
declare c record; k public.cc_wa_contactos; e record; v_seller uuid;
begin
  begin
    select id, profile_id, customer_id, visitor_id into c from public.cc_conversations where id = new.conversation_id;
    if not found or c.profile_id is not null or c.customer_id is not null or c.visitor_id is null then return new; end if;
    k := public._cc_wa_contacto_de(new.conversation_id);
    if k.wa_id is null then return new; end if;
    select * into e from (
      select 'difusion' tipo, x.id, x.customer_id, ('tu difusión «' || d.titulo || '»') que, d.seller_profile_id, x.enviado_at
        from public.cc_difusion_envios x join public.cc_difusiones d on d.id = x.difusion_id
       where x.canal = 'whatsapp' and x.estado = 'enviado' and x.destino = right(k.wa_id, 10) and x.enviado_at > now() - interval '30 days'
      union all
      select 'aviso', v.id, v.customer_id, ('el aviso «' || v.titulo || '»'), null::uuid, v.enviado_at
        from public.cc_wa_avisos v
       where v.estado = 'enviado' and v.destino = right(k.wa_id, 10) and v.enviado_at > now() - interval '30 days' and v.customer_id is not null
    ) z order by z.enviado_at desc limit 1;
    if not found then return new; end if;
    update public.cc_conversations set customer_id = e.customer_id, updated_at = now() where id = c.id and customer_id is null;
    if e.tipo = 'difusion' then update public.cc_difusion_envios set detalle = 'respondio' where id = e.id and detalle is null;
    else update public.cc_wa_avisos set respondio_at = coalesce(respondio_at, now()) where id = e.id; end if;
    v_seller := coalesce(public._cc_vendedor_de_cliente(e.customer_id), e.seller_profile_id);
    if v_seller is not null then
      perform public._cc_notificar('difusion_respuesta', c.id, array[v_seller], null,
        format('%s contestó %s por WhatsApp.', coalesce((select initcap(lower(full_name)) from public.customers where id = e.customer_id), 'Un cliente'), e.que),
        'asesorias', 'difusion_respuesta:' || c.id::text);
    end if;
  exception when others then
    raise warning 'DIFUSION-WA: no se ligó la respuesta (%): el mensaje sigue', sqlerrm;
  end;
  return new;
end;
$$;

alter function public._wa_avisos_reclamar(integer) owner to postgres;
alter function public._wa_avisos_resolver(bigint, text, text, text) owner to postgres;
revoke all on function public._wa_aviso_pedido_tr(), public._wa_avisos_reclamar(integer), public._wa_avisos_resolver(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public._wa_avisos_reclamar(integer), public._wa_avisos_resolver(bigint, text, text, text) to service_role;
revoke all on function public._difwa_despachar(), public._difwa_respuesta_tr() from public, anon, authenticated;

do $post$ begin
  if (select count(*) from public.cc_wa_plantillas where nombre in ('invitacion_cuenta', 'aviso_pedido_recibido', 'aviso_pago_confirmado', 'aviso_pedido_enviado', 'aviso_pedido_entregado', 'intente_llamarle')) <> 6 then
    raise exception 'WA-ESCRIBIR: faltan plantillas'; end if;
  if position('variables && array[' in pg_get_functiondef('public.cc_wa_plantilla_enviar(uuid,text,uuid,text)'::regprocedure)) = 0 then raise exception 'WA-ESCRIBIR: parche de envío'; end if;
  if has_function_privilege('authenticated', 'public._wa_avisos_reclamar(integer)', 'execute') then raise exception 'WA-ESCRIBIR: permisos inesperados'; end if;
end $post$;
