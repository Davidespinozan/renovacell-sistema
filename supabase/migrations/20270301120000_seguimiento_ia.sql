-- ============================================================================
-- IA MEJOR QUE EL HUMANO · D (2 nov 2026) · SEGUIMIENTO PROACTIVO: lo que un buen asesor hace sin que se lo pidan.
--   · carrito: dejó productos en su carrito y no terminó (20 h a 7 días sin moverlo) → se lo recuerda con su total y,
--     si está cerca, cuánto le falta para el siguiente nivel de precio (mismas reglas del pedido que cobra el servidor);
--   · recompra: ya le toca volver a pedir lo que usa (su propio ritmo de compra; si solo compró una vez, el ciclo típico
--     de la categoría) → le ofrece prepararle lo de siempre con el precio de esa cantidad;
--   · promoción: hay una promoción vigente de algo que ya compró → se la avisa con sus escalones.
-- Reglas de cortesía (las mismas del interés en el catálogo y más): un mensaje proactivo por doctor cada N horas (24) y
-- como mucho 2 por semana entre todos los tipos; nunca si un asesor lo está atendiendo o si escribió en los últimos 10
-- minutos (entonces solo se avisa al vendedor); solo L–S de 10 a 19 h de Culiacán; cada evento una sola vez; un tope por
-- corrida. Todo texto y todo monto los arma el servidor. Al doctor le llega push (este y el de interés en el catálogo).
-- Dirección prende o apaga cada tipo y ve qué pasó después (pedidos en los 7 días siguientes).
-- ============================================================================
create table if not exists public.cc_seguimiento_config (
  id boolean primary key default true check (id),
  carrito boolean not null default true, recompra boolean not null default true, promo boolean not null default true,
  horas_entre int not null default 24 check (horas_entre between 4 and 720),
  por_semana int not null default 2 check (por_semana between 1 and 7),
  max_por_corrida int not null default 25 check (max_por_corrida between 1 and 200),
  hora_desde int not null default 10 check (hora_desde between 0 and 23), hora_hasta int not null default 19 check (hora_hasta between 1 and 24),
  domingo boolean not null default false,
  updated_by uuid, updated_at timestamptz not null default now(),
  check (hora_desde < hora_hasta));
insert into public.cc_seguimiento_config (id) values (true) on conflict do nothing;

create table if not exists public.cc_seguimiento_envios (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('carrito', 'recompra', 'promo')),
  clave text not null check (length(clave) between 1 and 200),
  conversation_id uuid, product_id uuid, monto numeric, enviado_at timestamptz not null default now(),
  primary key (profile_id, tipo, clave));
create index if not exists cc_seguimiento_envios_at on public.cc_seguimiento_envios (enviado_at desc);
alter table public.cc_seguimiento_config enable row level security;
alter table public.cc_seguimiento_envios enable row level security;
revoke all on public.cc_seguimiento_config, public.cc_seguimiento_envios from public, anon, authenticated;

-- Ciclo típico de recompra por categoría (días) cuando el doctor solo ha comprado una vez. Aparatología no se recompra.
create or replace function public._cc_seg_ciclo_categoria(p_categoria text) returns int language sql immutable as
$$ select case p_categoria when 'Toxinas' then 90 when 'Rellenos' then 180 when 'Metabólicos' then 28 when 'Vitaminas' then 30 when 'Péptidos' then 30
     when 'Anestésicos' then 45 when 'Sérum' then 45 when 'Peeling' then 60 when 'Medicamentos' then 30 else null end $$;

-- ── 1 · ¿Se le puede escribir ahora? (lo comparten los tres tipos) ─────────────────────────────────
create or replace function public._cc_seg_puede(p_profile uuid, p_conv uuid, cfg public.cc_seguimiento_config) returns text
  language plpgsql stable security definer set search_path = public as
$$
declare cv record;
begin
  if public._cc_perfil_activo(p_profile) is distinct from 'doctor' then return 'no_doctor'; end if;
  if not coalesce((select verified from public.profiles where id = p_profile), false) then return 'sin_verificar'; end if;
  select * into cv from public.cc_conversations where id = p_conv;
  if cv.modo in ('human_assigned', 'human_active') then return 'asesor'; end if;
  if exists (select 1 from public.cc_messages m where m.conversation_id = p_conv and m.actor_type in ('doctor', 'visitor') and m.created_at > now() - interval '10 minutes') then return 'activo'; end if;
  if exists (select 1 from public.cc_messages m where m.conversation_id = p_conv and m.actor_type = 'ai' and (m.client_message_id like 'tpl:seg:%' or m.client_message_id like 'tpl:interes:%')
              and m.created_at > now() - make_interval(hours => cfg.horas_entre)) then return 'reciente'; end if;
  if (select count(*) from public.cc_messages m where m.conversation_id = p_conv and m.actor_type = 'ai' and (m.client_message_id like 'tpl:seg:%' or m.client_message_id like 'tpl:interes:%')
       and m.created_at > now() - interval '7 days') >= cfg.por_semana then return 'semana'; end if;
  return 'ok';
end;
$$;

-- ── 2 · Textos (servidor; precios con la misma autoridad que cobra) ────────────────────────────────
create or replace function public._cc_seg_nivel(p_product uuid, p_qty int) returns text language sql stable set search_path = public as
$$ select case v.nivel when 'mayoreo' then 'mayoreo' when 'medio' then 'medio mayoreo' end
     from public.product_volume_prices v where v.product_id = p_product and v.active and v.min_quantity <= p_qty order by v.min_quantity desc limit 1 $$;

create or replace function public._cc_seg_texto_carrito(p_profile uuid, p_cart uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_list uuid; v_lines jsonb; v_items text; v_total numeric; v_op jsonb; v_t text;
begin
  select price_list_id into v_list from public.profiles where id = p_profile;
  select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.quantity)), string_agg(i.quantity || ' ' || p.name, ', ' order by i.created_at)
    into v_lines, v_items from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart and i.quantity > 0;
  if v_lines is null then return null; end if;
  v_total := public._cc_lineas_total(v_lines, v_list);
  v_op := public._cc_oportunidades(v_lines, v_list) -> 0;
  v_t := '¡Hola' || coalesce(', ' || public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_profile)), '') || '! '
      || 'Te quedó pendiente tu carrito: ' || v_items || case when v_total > 0 then ' (' || public._cc_dinero(v_total) || ' en total)' else '' end || '. ';
  if v_op is not null and (v_op ->> 'faltan')::int <= greatest(3, (v_op ->> 'lleva')::int) then
    v_t := v_t || case v_op ->> 'tipo'
      when 'mayoreo' then 'Con ' || (v_op ->> 'faltan') || ' piezas más de ' || (v_op ->> 'nombre') || ' llegas a mayoreo y todo tu pedido baja de precio'
      when 'juntar_10' then 'Con ' || (v_op ->> 'faltan') || ' piezas más de productos de medio mayoreo de 10 llegas a medio mayoreo'
      else 'Con ' || (v_op ->> 'faltan') || ' piezas más de ' || (v_op ->> 'nombre') || ' llegas a medio mayoreo a ' || public._cc_dinero((v_op ->> 'precio_unitario_al_llegar')::numeric) || ' por pieza' end
      || case when (v_op ->> 'ahorro_en_lo_que_ya_lleva')::numeric > 0 then ' y ahorras ' || public._cc_dinero((v_op ->> 'ahorro_en_lo_que_ya_lleva')::numeric) || ' en lo que ya llevas' else '' end || '. ';
  end if;
  return jsonb_build_object('texto', v_t || '¿Te ayudo a terminarlo o quieres ajustar algo?', 'monto', v_total);
end;
$$;

create or replace function public._cc_seg_texto_recompra(p_profile uuid, p_product uuid, p_qty int, p_fecha date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_list uuid; v_prod text; v_precio numeric; v_nivel text; v_t text; v_mes text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select price_list_id into v_list from public.profiles where id = p_profile;
  select name into v_prod from public.products where id = p_product and active and sellable;
  if v_prod is null then return null; end if;
  v_precio := public.precio_de(p_product, v_list, greatest(p_qty, 1), greatest(p_qty, 1));
  v_nivel := public._cc_seg_nivel(p_product, p_qty);
  v_t := '¡Hola' || coalesce(', ' || public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_profile)), '') || '! '
      || 'El ' || extract(day from p_fecha)::int || ' de ' || v_mes[extract(month from p_fecha)::int] || ' llevaste ' || p_qty || ' ' || v_prod || '. ¿Te preparo el mismo pedido?'
      || case when v_precio is not null then ' Con ' || p_qty || ' te queda a ' || public._cc_dinero(v_precio) || ' por pieza' || coalesce(' (' || v_nivel || ')', '') || '.' else '' end;
  return jsonb_build_object('texto', v_t, 'monto', case when v_precio is not null then v_precio * p_qty end);
end;
$$;

create or replace function public._cc_seg_texto_promo(p_profile uuid, p_promo uuid, p_product uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_list uuid; v_info jsonb; v_prod text; v_t text; v_esc text;
begin
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_info := public._promo_info(p_product, v_list);
  if v_info is null or (v_info ->> 'promocion_id')::uuid is distinct from p_promo then return null; end if;
  select name into v_prod from public.products where id = p_product;
  select string_agg(case when (e ->> 'desde')::int <= 1 then public._cc_dinero((e ->> 'precio')::numeric) || ' por pieza' else 'desde ' || (e ->> 'desde') || ' piezas a ' || public._cc_dinero((e ->> 'precio')::numeric) end, '; ' order by (e ->> 'desde')::int)
    into v_esc from jsonb_array_elements(coalesce(v_info -> 'escalones', '[]'::jsonb)) e;
  v_t := '¡Hola' || coalesce(', ' || public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_profile)), '') || '! '
      || (v_info ->> 'nombre') || ' está vigente hasta el ' || to_char((v_info ->> 'hasta')::date, 'DD/MM') || ' en ' || v_prod || ', que ya has llevado'
      || coalesce(': ' || v_esc, '') || '. ¿Te lo cotizo con las piezas que necesitas?';
  return jsonb_build_object('texto', v_t);
end;
$$;

-- ── 3 · Candidatos (uno por doctor; carrito > recompra > promo) ───────────────────────────────────
create or replace function public._cc_seg_candidatos(cfg public.cc_seguimiento_config) returns table (profile_id uuid, tipo text, clave text, ref uuid, product_id uuid, qty int, fecha date, prioridad int)
  language sql stable security definer set search_path = public as
$$
  with carrito as (
    select k.profile_id, 'carrito'::text tipo, k.id::text || ':' || k.rev clave, k.id ref, null::uuid product_id, null::int qty, null::date fecha, 1 prioridad
      from public.cc_carts k
     where cfg.carrito and k.estado = 'active' and k.profile_id is not null and k.converted_order_id is null
       and coalesce(k.last_activity_at, k.updated_at) between now() - interval '7 days' and now() - interval '20 hours'
       and exists (select 1 from public.cc_cart_items i where i.cart_id = k.id and i.quantity > 0)),
  compras as (
    select coalesce(o.doctor_id, (select c.profile_id from public.customers c where c.id = o.customer_id)) profile_id, oi.product_id, o.id order_id, o.created_at::date fecha, sum(oi.qty)::int qty
      from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.status <> 'cancelled' and o.created_at > now() - interval '18 months'
     group by 1, 2, 3, 4),
  ritmo as (
    select c.profile_id, c.product_id, max(c.fecha) ultima, (array_agg(c.qty order by c.fecha desc))[1] qty, (array_agg(c.order_id order by c.fecha desc))[1] order_id,
           percentile_cont(0.5) within group (order by c.gap) ciclo_propio
      from (select c.*, c.fecha - lag(c.fecha) over (partition by c.profile_id, c.product_id order by c.fecha) gap from compras c) c
     where c.profile_id is not null group by 1, 2),
  recompra as (
    select r.profile_id, 'recompra'::text, r.product_id::text || ':' || r.order_id, r.order_id, r.product_id, r.qty, r.ultima, 2
      from ritmo r join public.products p on p.id = r.product_id and p.active and p.sellable
      -- ritmo propio si compró 2+ veces (mínimo 14 días); si no, el de su categoría (ojo: greatest() ignora NULL, por eso el case)
      cross join lateral (select case when r.ciclo_propio is null then public._cc_seg_ciclo_categoria(p.category) else greatest(round(r.ciclo_propio)::int, 14) end ciclo) z
     where cfg.recompra and z.ciclo is not null and current_date - r.ultima between z.ciclo - 3 and z.ciclo * 2 + 14),
  promo as (
    select distinct on (c.profile_id, l.promocion_id) c.profile_id, 'promo'::text, l.promocion_id::text, l.promocion_id, l.product_id, null::int, null::date, 3
      from public.promociones pr join public.promocion_lineas l on l.promocion_id = pr.id
      join compras c on c.product_id = l.product_id and c.fecha > current_date - 365
     where cfg.promo and pr.activa and pr.desde <= public.hoy_local() and pr.hasta >= public.hoy_local()
       and not exists (select 1 from public.customers cu where cu.profile_id = c.profile_id and cu.difusiones_baja_at is not null)   -- quien se dio de baja de difusiones no recibe promociones
     order by c.profile_id, l.promocion_id, c.fecha desc)
  select distinct on (x.profile_id) x.* from (select * from carrito union all select * from recompra union all select * from promo) x
   where not exists (select 1 from public.cc_seguimiento_envios e where e.profile_id = x.profile_id and e.tipo = x.tipo and e.clave = x.clave)
   order by x.profile_id, x.prioridad, x.fecha nulls first
$$;

-- ── 4 · Despachar (cada 15 min por cron) ──────────────────────────────────────────────────────────
create or replace function public.cc_seguimiento_despachar() returns int
  language plpgsql security definer set search_path = public as
$$
declare cfg public.cc_seguimiento_config; c record; v_local timestamp := now() at time zone 'America/Mazatlan'; v_conv uuid; v_seller uuid; v_cu uuid; v_puede text;
  v_t jsonb; v_seq bigint; v_cid text; v_nombre text; n int := 0; v_que text;
begin
  select * into cfg from public.cc_seguimiento_config where id;
  if not (cfg.carrito or cfg.recompra or cfg.promo) then return 0; end if;
  if (extract(isodow from v_local) = 7 and not cfg.domingo) or extract(hour from v_local) < cfg.hora_desde or extract(hour from v_local) >= cfg.hora_hasta then return 0; end if;
  for c in select * from public._cc_seg_candidatos(cfg) limit cfg.max_por_corrida * 4 loop
    exit when n >= cfg.max_por_corrida;
    v_conv := (public._cc_conversacion_de(null, c.profile_id) ->> 'conversation_id')::uuid;
    if v_conv is null then continue; end if;
    v_puede := public._cc_seg_puede(c.profile_id, v_conv, cfg);
    v_cu := public._cc_chk_customer(c.profile_id);
    v_seller := coalesce((select seller_profile_id from public.cc_conversations where id = v_conv), public._cc_vendedor_de_cliente(v_cu));
    v_nombre := coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Un cliente');
    v_que := case c.tipo when 'carrito' then 'dejó su carrito sin terminar' when 'recompra' then 'ya le toca volver a pedir ' || coalesce((select name from public.products where id = c.product_id), 'lo de siempre')
                         else 'compró antes un producto que hoy está en promoción' end;
    if v_puede in ('asesor', 'activo') then
      -- No se interrumpe: el vendedor se entera y decide. El evento cuenta como atendido.
      if v_seller is not null then perform public._cc_notificar('seguimiento', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || '.', 'asesorias', 'seg:' || c.profile_id || ':' || c.tipo || ':' || md5(c.clave)); end if;
      insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id) values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id) on conflict do nothing;
      continue;
    end if;
    if v_puede <> 'ok' then continue; end if;   -- respiro o tope semanal: se reintenta en otra corrida
    v_t := case c.tipo when 'carrito' then public._cc_seg_texto_carrito(c.profile_id, c.ref)
                       when 'recompra' then public._cc_seg_texto_recompra(c.profile_id, c.product_id, c.qty, c.fecha)
                       else public._cc_seg_texto_promo(c.profile_id, c.ref, c.product_id) end;
    if v_t is null or nullif(v_t ->> 'texto', '') is null then
      insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id) values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id) on conflict do nothing;
      continue;
    end if;
    v_cid := 'tpl:seg:' || c.tipo || ':' || c.profile_id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = v_conv returning ultimo_seq into v_seq;
    insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
    values (v_conv, v_seq, 'ai', v_cid, v_t ->> 'texto', md5(v_t ->> 'texto')) on conflict do nothing;
    insert into public.cc_seguimiento_envios (profile_id, tipo, clave, conversation_id, product_id, monto)
    values (c.profile_id, c.tipo, c.clave, v_conv, c.product_id, (v_t ->> 'monto')::numeric) on conflict do nothing;
    if v_seller is not null then
      perform public._cc_notificar('seguimiento', v_conv, array[v_seller], null, v_nombre || ' ' || v_que || '; la IA ya le escribió.', 'asesorias', 'seg:' || c.profile_id || ':' || c.tipo || ':' || md5(c.clave));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── 5 · Push al doctor por los mensajes proactivos de la IA (seguimiento e interés en el catálogo) ──
create or replace function public.ia_proactivo_push_carga(p_msg uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return (select jsonb_build_object('perfiles', jsonb_build_array(v.profile_id), 'conversation_id', m.conversation_id, 'texto', m.content)
            from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id
           where m.id = p_msg and m.actor_type = 'ai' and (m.client_message_id like 'tpl:seg:%' or m.client_message_id like 'tpl:interes:%') and v.profile_id is not null);
end;
$$;

create or replace function public._cc_proactivo_push_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text; v_dueno uuid;
begin
  begin
    select profile_id into v_dueno from public.cc_conversations where id = new.conversation_id;
    if v_dueno is null or not exists (select 1 from public.push_suscripciones s where s.activo and s.profile_id = v_dueno) then return new; end if;
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
    if v_url is null or v_secreto is null then return new; end if;
    perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/push',
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                          body := jsonb_build_object('action', 'ia_proactivo', 'id', new.id), timeout_milliseconds := 10000);
  exception when others then
    raise warning 'PUSH_PROACTIVO: % (el mensaje se guardó)', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists cc_proactivo_push on public.cc_messages;
create trigger cc_proactivo_push after insert on public.cc_messages for each row
  when (new.actor_type = 'ai' and (new.client_message_id like 'tpl:seg:%' or new.client_message_id like 'tpl:interes:%'))
  execute function public._cc_proactivo_push_tr();

-- ── 6 · Dirección: interruptores y qué pasó después ──────────────────────────────────────────────
create or replace function public.seguimiento_config() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  return (select to_jsonb(c) - 'id' - 'updated_by' from public.cc_seguimiento_config c where id);
end;
$$;

create or replace function public.seguimiento_config_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc_exige_admin();
  update public.cc_seguimiento_config set
    carrito = coalesce((p ->> 'carrito')::boolean, carrito), recompra = coalesce((p ->> 'recompra')::boolean, recompra), promo = coalesce((p ->> 'promo')::boolean, promo),
    horas_entre = coalesce((p ->> 'horas_entre')::int, horas_entre), por_semana = coalesce((p ->> 'por_semana')::int, por_semana),
    updated_by = auth.uid(), updated_at = now() where id;
  return public.seguimiento_config();
end;
$$;

create or replace function public.seguimiento_resumen(p_dias int default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365));
begin
  perform public._cc_exige_admin();
  return coalesce((select jsonb_object_agg(tipo, x) from (
    select e.tipo, jsonb_build_object('enviados', count(*),
      'respondieron', count(*) filter (where exists (select 1 from public.cc_messages m where m.conversation_id = e.conversation_id and m.actor_type = 'doctor' and m.created_at between e.enviado_at and e.enviado_at + interval '3 days')),
      'con_pedido', count(*) filter (where o.total is not null), 'vendido', coalesce(round(sum(o.total)), 0)) x
      from public.cc_seguimiento_envios e
      left join lateral (select o.total from public.orders o where o.doctor_id = e.profile_id and o.status <> 'cancelled' and o.created_at between e.enviado_at and e.enviado_at + interval '7 days' order by o.created_at limit 1) o on true
     where e.enviado_at >= v_desde group by e.tipo) z), '{}'::jsonb);
end;
$$;

do $g$ begin
  execute 'revoke all on function public._cc_seg_ciclo_categoria(text), public._cc_seg_puede(uuid, uuid, public.cc_seguimiento_config), public._cc_seg_nivel(uuid, int), public._cc_seg_texto_carrito(uuid, uuid), public._cc_seg_texto_recompra(uuid, uuid, int, date), public._cc_seg_texto_promo(uuid, uuid, uuid), public._cc_seg_candidatos(public.cc_seguimiento_config), public.cc_seguimiento_despachar(), public.ia_proactivo_push_carga(uuid), public._cc_proactivo_push_tr() from public, anon, authenticated';
  execute 'grant execute on function public.ia_proactivo_push_carga(uuid) to service_role';
  execute 'revoke all on function public.seguimiento_config(), public.seguimiento_config_guardar(jsonb), public.seguimiento_resumen(int) from public, anon';
  execute 'grant execute on function public.seguimiento_config(), public.seguimiento_config_guardar(jsonb), public.seguimiento_resumen(int) to authenticated';
end $g$;

-- Cron cada 15 min (firma exacta tras quitar el anterior por nombre).
do $cron$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'renovacell-seguimiento' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('renovacell-seguimiento'::text, '*/15 * * * *'::text, 'select public.cc_seguimiento_despachar();'::text);
end $cron$;
do $post$ begin
  if to_regprocedure('public.cc_seguimiento_despachar()') is null or (select count(*) from cron.job where jobname = 'renovacell-seguimiento' and active) <> 1 then
    raise exception 'SEGUIMIENTO: falta el despachador o su cron';
  end if;
end $post$;
