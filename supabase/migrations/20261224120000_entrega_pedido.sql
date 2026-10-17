-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ENTREGA DEL PEDIDO (migración 171) · ENT-0: CÓMO Y CUÁNDO LLEGA, DECIDIDO EN EL SERVIDOR
--   Pedido del dueño (17 oct 2026): "los pedidos de punto de venta normalmente se tiene que elegir cuándo y dónde se
--   entrega … el cliente en su portal: envíos arriba de $5,000 gratis, abajo cuesta $600; locales arriba de $500 gratis
--   y abajo de $500 pasa a recoger; si vende el vendedor, él elige el tipo de envío (DHL/T1/chofer); al cliente SIEMPRE
--   se le muestra la fecha o el rango de llegada; antes de las 3:30 pm sale el mismo día, después al día siguiente".
--   Decisiones: local = Culiacán (por CP); los precios ya incluyen IVA (el umbral es sobre el importe de productos);
--   el vendedor ve la regla como propuesta y puede ajustar el flete con motivo; entrega local por chofer; mostrador
--   existe pero es raro; T1 aún no se integra (queda apagado en la configuración).
--   · entrega_config            UNA fila: corte, umbrales, costos, CP locales, días de salida, tránsito, recoger.
--   · entrega_opciones          (doctor o personal) las opciones válidas con flete y promesa (salida, llega desde/hasta).
--   · _entrega_normalizar       valida la elección contra la regla del servidor (el cliente nunca manda el flete).
--   · _entrega_aplicar          escribe la entrega en el pedido: shipping_meta.entrega, orders.shipping_cost y el total.
--   · crear_pedido_con_entrega  pedido (crear_pedido_con_receptor, sin cambios) + entrega en UNA transacción.
--   · cc_checkout_revisar/confirmar (checkout del doctor) revisan y aplican la entrega; recoger no exige dirección.
--   · orders.shipping_cost      el flete cobrado al cliente (0 si no hay); total = productos + flete.
--   NO cambia: crear_pedido, crear_pedido_con_receptor, vender_pos (Caja = mostrador), Empaque ni la paquetería (DHL).
--   Depende de la 147 (crear_pedido_con_receptor), la 119 (cc_checkout_revisar con p_direccion) y la 137 (confirmar).
--   Aplicar en UNA transacción. Rollback: supabase/rollback/entrega_pedido/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.entrega_config') is not null then raise exception 'ENTREGA: ya aplicada'; end if;
  if to_regprocedure('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)') is null then raise exception 'ENTREGA: falta la 147'; end if;
  if md5(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb)'::regprocedure)) <> 'de58088479a7c4a5ee971c240f442802' then raise exception 'ENTREGA: cc_checkout_revisar no es la versión de la 119'; end if;
  if md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) <> '49129e57d5f044e624a6d61621fb3bce' then raise exception 'ENTREGA: cc_checkout_confirmar no es la versión de la 137'; end if;
  if md5(pg_get_functiondef('public._cc_chk_resultado(uuid,uuid,boolean)'::regprocedure)) <> '10f9f4dfaaaac23e1025ade13ac62f2e' then raise exception 'ENTREGA: _cc_chk_resultado no es la versión de la 117'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cc_checkout_revisar', 'cc_checkout_confirmar')) <> 2 then raise exception 'ENTREGA: firmas inesperadas del checkout'; end if;
end $pre$;

-- ---------------------------------------------------------------------------------------------------
-- 1) CONFIGURACIÓN (una fila). Dirección la edita con entrega_config_guardar; todos la leen por entrega_opciones.
-- ---------------------------------------------------------------------------------------------------
create table public.entrega_config (
  id                     smallint primary key default 1 constraint ck_entcfg_unica check (id = 1),
  corte                  time not null default '15:30',                 -- hora local de corte: antes sale hoy
  foraneo_gratis_desde   numeric not null default 5000 check (foraneo_gratis_desde >= 0),
  foraneo_costo          numeric not null default 600  check (foraneo_costo >= 0),
  local_gratis_desde     numeric not null default 500  check (local_gratis_desde >= 0),
  local_costo            numeric not null default 0    check (local_costo >= 0),   -- solo lo usa el personal bajo el mínimo
  cp_local_desde         text not null default '80000' check (cp_local_desde ~ '^[0-9]{5}$'),
  cp_local_hasta         text not null default '80299' check (cp_local_hasta ~ '^[0-9]{5}$'),
  dias_paqueteria        smallint[] not null default '{1,2,3,4,5}',     -- ISO: 1 = lunes … 7 = domingo (recolección)
  dias_chofer            smallint[] not null default '{1,2,3,4,5,6}',   -- entregas locales y pedidos listos para recoger
  dias_entrega_foranea   smallint[] not null default '{1,2,3,4,5}',     -- días en que la paquetería entrega
  dhl_transito_min       smallint not null default 1 check (dhl_transito_min between 0 and 30),
  dhl_transito_max       smallint not null default 3 check (dhl_transito_max between 0 and 30),
  t1_activo              boolean not null default false,
  t1_transito_min        smallint not null default 2 check (t1_transito_min between 0 and 30),
  t1_transito_max        smallint not null default 5 check (t1_transito_max between 0 and 30),
  local_mismo_dia        boolean not null default true,                 -- el chofer entrega el mismo día que sale
  recoge_lugar           text not null default 'Sucursal Renovacell, Culiacán' check (length(recoge_lugar) between 3 and 200),
  recoge_horario         text not null default 'Lunes a sábado de 10:00 a 18:00' check (length(recoge_horario) between 3 and 200),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles(id),
  constraint ck_entcfg_cp_rango check (cp_local_desde <= cp_local_hasta),
  constraint ck_entcfg_dhl check (dhl_transito_min <= dhl_transito_max),
  constraint ck_entcfg_t1 check (t1_transito_min <= t1_transito_max),
  constraint ck_entcfg_dias check (dias_paqueteria <@ '{1,2,3,4,5,6,7}'::smallint[] and dias_chofer <@ '{1,2,3,4,5,6,7}'::smallint[] and dias_entrega_foranea <@ '{1,2,3,4,5,6,7}'::smallint[]
                                   and cardinality(dias_paqueteria) > 0 and cardinality(dias_chofer) > 0 and cardinality(dias_entrega_foranea) > 0)
);
insert into public.entrega_config default values;
comment on table public.entrega_config is 'ENT-0 · regla de entrega (una fila): corte, umbrales de envío gratis, costos, CP locales, días de salida y tránsito, lugar para recoger.';
alter table public.entrega_config enable row level security;
revoke all on public.entrega_config from public, anon, authenticated;

alter table public.orders add column shipping_cost numeric not null default 0 constraint ck_orders_shipping_cost check (shipping_cost >= 0);
comment on column public.orders.shipping_cost is 'ENT-0 · flete cobrado al cliente (ya incluido en total). 0 = sin cargo. El detalle vive en shipping_meta.entrega.';
alter table public.cc_checkout_reviews add column entrega jsonb;
comment on column public.cc_checkout_reviews.entrega is 'ENT-0 · entrega revisada (opción, costo y promesa) que se aplica al confirmar.';

-- ---------------------------------------------------------------------------------------------------
-- 2) CALENDARIO: días válidos, siguiente día, sumar días hábiles. Respeta las excepciones "cerrado" del horario (CC-7).
-- ---------------------------------------------------------------------------------------------------
create function public._entrega_zona() returns text
  language sql stable set search_path = public as
$$ select coalesce((select zona from public.cc_horario_config where id = 1), 'America/Mazatlan') $$;

create function public._entrega_dia_valido(p_dia date, p_dias smallint[]) returns boolean
  language sql stable set search_path = public as
$$ select extract(isodow from p_dia)::smallint = any (p_dias)
      and not exists (select 1 from public.cc_horario_excepciones e where e.fecha = p_dia and e.tipo = 'cerrado') $$;

/** Primer día válido a partir de p_desde (inclusive). */
create function public._entrega_siguiente_dia(p_desde date, p_dias smallint[]) returns date
  language plpgsql stable set search_path = public as
$$
declare i int;
begin
  for i in 0..60 loop
    if public._entrega_dia_valido(p_desde + i, p_dias) then return p_desde + i; end if;
  end loop;
  raise exception 'ENTREGA_CALENDARIO: no hay un día de salida en los próximos 60 días';
end;
$$;

/** p_n días válidos DESPUÉS de p_desde (0 → el mismo día). */
create function public._entrega_sumar_dias(p_desde date, p_n int, p_dias smallint[]) returns date
  language plpgsql stable set search_path = public as
$$
declare d date := p_desde; n int := 0;
begin
  if p_n <= 0 then return d; end if;
  for i in 1..120 loop
    d := p_desde + i;
    if public._entrega_dia_valido(d, p_dias) then n := n + 1; if n = p_n then return d; end if; end if;
  end loop;
  raise exception 'ENTREGA_CALENDARIO: no se pudo calcular la fecha de llegada';
end;
$$;

/** Día de salida: antes del corte (hora local) y día válido → hoy; si no, el siguiente día válido. */
create function public._entrega_salida(p_ahora timestamptz, p_dias smallint[]) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare cfg public.entrega_config%rowtype; loc timestamp; hoy date; antes boolean;
begin
  select * into cfg from public.entrega_config where id = 1;
  loc := p_ahora at time zone public._entrega_zona();
  hoy := loc::date; antes := loc::time < cfg.corte;
  return jsonb_build_object('salida', case when antes and public._entrega_dia_valido(hoy, p_dias) then hoy else public._entrega_siguiente_dia(hoy + 1, p_dias) end,
                            'antes_de_corte', antes, 'hoy', hoy, 'corte', to_char(cfg.corte, 'HH24:MI'), 'zona', public._entrega_zona());
end;
$$;

create function public._entrega_es_local(p_cp text) returns boolean
  language sql stable set search_path = public as
$$ select p_cp ~ '^[0-9]{5}$' and p_cp between c.cp_local_desde and c.cp_local_hasta from public.entrega_config c where c.id = 1 $$;

-- ---------------------------------------------------------------------------------------------------
-- 3) OPCIONES: lo que puede elegir quien pide (doctor en su portal | personal en punto de venta), con costo y promesa.
--    p_subtotal = importe de productos (con IVA incluido, como los precios). p_cp = CP del domicilio elegido (o null).
-- ---------------------------------------------------------------------------------------------------
-- Una opción de entrega (forma única para el portal y el punto de venta).
create function public._entrega_opcion(p_id text, p_tipo text, p_paq text, p_costo numeric, p_permitido boolean, p_motivo text, p_disponible boolean, p_salida jsonb, p_desde date, p_hasta date, p_texto text) returns jsonb
  language sql immutable as
$$ select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'paqueteria', p_paq, 'flete', p_costo, 'permitido', p_permitido, 'motivo', p_motivo, 'disponible', p_disponible,
                             'salida', p_salida ->> 'salida', 'antes_de_corte', (p_salida ->> 'antes_de_corte')::boolean, 'llega_desde', p_desde, 'llega_hasta', p_hasta, 'texto', p_texto) $$;

create function public.entrega_opciones(p_actor text, p_subtotal numeric, p_cp text, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  cfg public.entrega_config%rowtype; v_local boolean; v_cp text; v_doc boolean; v_sub numeric := greatest(coalesce(p_subtotal, 0), 0);
  s_paq jsonb; s_cho jsonb; ops jsonb := '[]'::jsonb; sug text;
  c_for numeric; c_loc numeric; v_dir boolean;
begin
  if p_actor not in ('doctor', 'staff') then raise exception 'ENTREGA_ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_doc := p_actor = 'doctor';
  select * into cfg from public.entrega_config where id = 1;
  v_cp := nullif(btrim(coalesce(p_cp, '')), '');
  v_dir := coalesce(v_cp ~ '^[0-9]{5}$', false);
  v_local := v_dir and coalesce(public._entrega_es_local(v_cp), false);
  s_paq := public._entrega_salida(p_ahora, cfg.dias_paqueteria);
  s_cho := public._entrega_salida(p_ahora, cfg.dias_chofer);
  c_for := case when v_sub >= cfg.foraneo_gratis_desde then 0 else cfg.foraneo_costo end;
  c_loc := case when v_sub >= cfg.local_gratis_desde then 0 else cfg.local_costo end;

  -- mostrador: el cliente se lleva el producto en el acto (solo personal)
  ops := ops || public._entrega_opcion('mostrador', 'mostrador', null, 0, not v_doc, case when v_doc then 'SOLO_PERSONAL' end, true,
                       jsonb_build_object('salida', (s_cho ->> 'hoy'), 'antes_de_corte', (s_cho ->> 'antes_de_corte')::boolean), (s_cho ->> 'hoy')::date, (s_cho ->> 'hoy')::date, 'Entrega en mostrador');
  -- recoger en sucursal: siempre se puede; está listo el día de salida del chofer
  ops := ops || public._entrega_opcion('recoge', 'recoge', null, 0, true, null, true, s_cho, (s_cho ->> 'salida')::date, (s_cho ->> 'salida')::date, 'Recoger en ' || cfg.recoge_lugar);
  -- entrega local por chofer
  ops := ops || public._entrega_opcion('local_chofer', 'local', 'chofer', c_loc,
                       case when not v_doc then true when not v_dir then false when not v_local then false else v_sub >= cfg.local_gratis_desde end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and not v_local then 'ZONA_FORANEA' when v_doc and v_sub < cfg.local_gratis_desde then 'MINIMO_LOCAL' end,
                       true, s_cho, case when cfg.local_mismo_dia then (s_cho ->> 'salida')::date else public._entrega_sumar_dias((s_cho ->> 'salida')::date, 1, cfg.dias_chofer) end,
                       case when cfg.local_mismo_dia then (s_cho ->> 'salida')::date else public._entrega_sumar_dias((s_cho ->> 'salida')::date, 1, cfg.dias_chofer) end,
                       'Entrega local (chofer de Renovacell)');
  -- envío foráneo por DHL
  ops := ops || public._entrega_opcion('foraneo_dhl', 'foraneo', 'dhl', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and v_local then 'ZONA_LOCAL' end,
                       true, s_paq, public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.dhl_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.dhl_transito_max, cfg.dias_entrega_foranea), 'Envío por DHL');
  -- envío foráneo por T1 (apagado hasta integrarlo)
  ops := ops || public._entrega_opcion('foraneo_t1', 'foraneo', 't1', c_for,
                       case when not v_doc then true when not v_dir then false else not v_local end,
                       case when v_doc and not v_dir then 'REQUIERE_DIRECCION' when v_doc and v_local then 'ZONA_LOCAL' end,
                       cfg.t1_activo, s_paq, public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.t1_transito_min, cfg.dias_entrega_foranea),
                       public._entrega_sumar_dias((s_paq ->> 'salida')::date, cfg.t1_transito_max, cfg.dias_entrega_foranea), 'Envío por T1');

  sug := case when not v_dir then null when v_local then (case when v_doc and v_sub < cfg.local_gratis_desde then 'recoge' else 'local_chofer' end) else 'foraneo_dhl' end;
  return jsonb_build_object('actor', p_actor, 'subtotal', v_sub, 'cp', v_cp, 'local', v_local,
                            'corte', jsonb_build_object('hora', s_cho ->> 'corte', 'zona', s_cho ->> 'zona', 'antes_de_corte', (s_cho ->> 'antes_de_corte')::boolean, 'hoy', s_cho ->> 'hoy'),
                            'regla', jsonb_build_object('foraneo_gratis_desde', cfg.foraneo_gratis_desde, 'foraneo_flete', cfg.foraneo_costo, 'local_gratis_desde', cfg.local_gratis_desde),
                            'recoge', jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario),
                            'sugerida', sug, 'opciones', ops);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4) NORMALIZAR la elección: el servidor decide el flete (el doctor no lo manda; el personal puede ajustarlo con motivo).
-- ---------------------------------------------------------------------------------------------------
create function public._entrega_normalizar(p_actor text, p_subtotal numeric, p_cp text, p_eleccion jsonb, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare ops jsonb; o jsonb; v_id text; v_costo numeric; v_motivo text; cfg public.entrega_config%rowtype;
begin
  if p_eleccion is null or jsonb_typeof(p_eleccion) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  v_id := nullif(btrim(coalesce(p_eleccion ->> 'opcion', '')), '');
  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = v_id;
  if o is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  if not (o ->> 'permitido')::boolean then raise exception 'ENTREGA_NO_PERMITIDA: %', coalesce(o ->> 'motivo', 'esa entrega no aplica') using errcode = 'check_violation'; end if;
  if not (o ->> 'disponible')::boolean then raise exception 'ENTREGA_NO_DISPONIBLE: esa paquetería aún no está activa' using errcode = 'check_violation'; end if;
  v_costo := (o ->> 'flete')::numeric;
  if p_actor = 'staff' and p_eleccion ? 'flete' and jsonb_typeof(p_eleccion -> 'flete') = 'number' then
    if (p_eleccion ->> 'flete')::numeric < 0 or (p_eleccion ->> 'flete')::numeric > 99999 then raise exception 'ENTREGA_FLETE_INVALIDO' using errcode = 'check_violation'; end if;
    if (p_eleccion ->> 'flete')::numeric <> v_costo then
      v_motivo := nullif(btrim(left(coalesce(p_eleccion ->> 'motivo', ''), 200)), '');
      if v_motivo is null or length(v_motivo) < 3 then raise exception 'ENTREGA_AJUSTE_SIN_MOTIVO: para cambiar el flete escribe el motivo' using errcode = 'check_violation'; end if;
      v_costo := round((p_eleccion ->> 'flete')::numeric, 2);
    end if;
  end if;
  select * into cfg from public.entrega_config where id = 1;
  return jsonb_strip_nulls(jsonb_build_object(
    'opcion', o ->> 'id', 'tipo', o ->> 'tipo', 'paqueteria', o -> 'paqueteria', 'texto', o ->> 'texto',
    'flete', v_costo, 'flete_regla', (o ->> 'flete')::numeric, 'ajuste_motivo', v_motivo,
    'local', ops -> 'local', 'cp', ops -> 'cp', 'subtotal', ops -> 'subtotal',
    'salida', o -> 'salida', 'antes_de_corte', o -> 'antes_de_corte', 'llega_desde', o -> 'llega_desde', 'llega_hasta', o -> 'llega_hasta',
    'recoge', case when o ->> 'tipo' = 'recoge' then jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario) end,
    'actor', p_actor, 'calculado_at', p_ahora));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5) APLICAR al pedido (interno; lo llaman los comandos del servidor dentro de su transacción).
-- ---------------------------------------------------------------------------------------------------
create function public._entrega_aplicar(p_order uuid, p_entrega jsonb) returns void
  language plpgsql set search_path = public as
$$
declare o record; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_costo numeric := (p_entrega ->> 'flete')::numeric;
begin
  select id, shipping_cost, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.shipping_meta ? 'entrega' then
    if o.shipping_meta -> 'entrega' ->> 'opcion' = p_entrega ->> 'opcion' and o.shipping_cost = v_costo then return; end if;   -- ya aplicada (reintento)
    raise exception 'ENTREGA_YA_FIJADA: la entrega del pedido ya quedó registrada' using errcode = 'check_violation';
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set shipping_cost = v_costo, total = coalesce(total, 0) + v_costo,
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('entrega', p_entrega)
   where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
end;
$$;

-- El flete del pedido solo lo escriben los comandos del servidor (como el total): nadie lo edita a mano.
create function public._orders_shipping_cost_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if new.shipping_cost is distinct from old.shipping_cost
     and coalesce(current_setting('app.trusted', true), '') <> 'on'
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'FLETE_SOLO_POR_COMANDO: el flete del pedido lo fija el servidor al crearlo' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger orders_shipping_cost_guard before update of shipping_cost on public.orders for each row execute function public._orders_shipping_cost_guard();

-- ---------------------------------------------------------------------------------------------------
-- 6) PEDIDO + ENTREGA (personal y doctor por el flujo directo). crear_pedido_con_receptor NO cambia.
-- ---------------------------------------------------------------------------------------------------
create function public.crear_pedido_con_entrega(
  p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb,
  p_invoice_requested boolean, p_customer_id uuid, p_receiver jsonb, p_entrega jsonb
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); v_actor text; v_res jsonb; v_ent jsonb; v_cp text; o record; v_tipo text;
begin
  if not ((v_rol = 'doctor' and p_doctor_id = auth.uid() and public.is_verified()) or v_rol = any (array['admin', 'pos'])) then
    raise exception 'No autorizado';
  end if;
  v_actor := case when v_rol = 'doctor' then 'doctor' else 'staff' end;
  if p_entrega is null or jsonb_typeof(p_entrega) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  -- La opción se valida con un importe provisional (0) solo para saber si exige domicilio; el costo real se calcula
  -- después con el importe que fija crear_pedido.
  v_tipo := (select x ->> 'tipo' from jsonb_array_elements(public.entrega_opciones(v_actor, 0, null, now()) -> 'opciones') x where x ->> 'id' = p_entrega ->> 'opcion');
  if v_tipo is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  v_cp := nullif(btrim(coalesce(p_shipping_meta -> 'address' ->> 'cp', '')), '');
  if v_tipo in ('foraneo', 'local') and (public._cc_chk_direccion_snapshot(p_shipping_meta -> 'address') is null or v_cp !~ '^[0-9]{5}$') then
    raise exception 'ENTREGA_SIN_DIRECCION: ese tipo de entrega necesita calle y código postal de 5 dígitos' using errcode = 'check_violation';
  end if;

  v_res := public.crear_pedido_con_receptor(p_order_id, p_folio, p_doctor_id, p_lines, p_shipping_meta, p_invoice_requested, p_customer_id, p_receiver);
  if coalesce((v_res ->> 'idempotent')::boolean, false) then
    select shipping_cost, total, shipping_meta -> 'entrega' as entrega into o from public.orders where id = p_order_id;
    return v_res || jsonb_build_object('total', o.total, 'envio', o.shipping_cost, 'entrega', o.entrega);
  end if;
  v_ent := public._entrega_normalizar(v_actor, (v_res ->> 'total')::numeric, v_cp, p_entrega, now());
  perform public._entrega_aplicar(p_order_id, v_ent);
  return v_res || jsonb_build_object('subtotal', (v_res ->> 'total')::numeric, 'envio', (v_ent ->> 'flete')::numeric,
                                     'total', (v_res ->> 'total')::numeric + (v_ent ->> 'flete')::numeric, 'entrega', v_ent);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7) CHECKOUT DEL DOCTOR: revisar devuelve las opciones y fija la elegida; confirmar la aplica al pedido.
--    Texto de la 119 (revisar) y la 137 (confirmar) + entrega. Recoger no exige dirección.
-- ---------------------------------------------------------------------------------------------------
drop function public.cc_checkout_revisar(uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.cc_checkout_revisar(p_cart uuid, p_location_id uuid DEFAULT NULL::uuid, p_direccion jsonb DEFAULT NULL::jsonb, p_entrega jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c record; prep jsonb; lin jsonb; dir jsonb; problemas jsonb; rv uuid; v_exp timestamptz; v_rol text := public.auth_role(); v_cust uuid;
        v_ops jsonb; v_ent jsonb; v_elec text; v_msg text; v_dir_ok boolean;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_rol <> 'doctor' then raise exception 'NO_AUTORIZADO: el checkout es del doctor dueño (el personal usa su flujo de pedidos)' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_carts where id = p_cart;
  if not found or c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);   -- autoridad de lectura CC-4 para este comando (dueño ya verificado arriba)
  if c.estado = 'converted' then return jsonb_build_object('listo', false, 'problemas', '["YA_CONVERTIDO"]'::jsonb, 'order_id', c.converted_order_id, 'cart_id', c.id); end if;
  if c.estado <> 'active' then return jsonb_build_object('listo', false, 'problemas', '["CARRITO_CERRADO"]'::jsonb, 'cart_id', c.id); end if;
  -- CC-5: proyección + problemas base (cuenta, verificación, vendible, precio, disponibilidad)
  prep := public.cc_carrito_preparar_checkout(p_cart, 'doctor', null, v_uid);
  problemas := prep -> 'problemas';
  lin := public._cc_chk_lineas(p_cart, v_uid);
  -- CC-7 · el Catálogo puede mandar un SNAPSHOT de dirección (como el flujo legado); se valida aquí.
  dir := case when p_location_id is null and p_direccion is not null then public._cc_chk_direccion_snapshot(p_direccion)
              else public._cc_chk_direccion(v_uid, p_location_id) end;
  -- ENT-0 · opciones de entrega con el importe de productos y el CP del domicilio. La entrega la ELIGE el doctor (el
  -- portal le muestra las opciones y la sugerida); el servidor nunca la decide por él: sin elección no hay revisión lista.
  v_ops := public.entrega_opciones('doctor', coalesce((lin ->> 'total')::numeric, 0), dir -> 'address' ->> 'cp', now());
  v_elec := nullif(btrim(coalesce(p_entrega ->> 'opcion', '')), '');
  if v_elec is null then
    problemas := problemas || '"REQUIERE_ENTREGA"'::jsonb;
  else
    begin
      v_ent := public._entrega_normalizar('doctor', coalesce((lin ->> 'total')::numeric, 0), dir -> 'address' ->> 'cp', jsonb_build_object('opcion', v_elec), now());
    exception when check_violation then
      get stacked diagnostics v_msg = message_text;
      problemas := problemas || to_jsonb(split_part(v_msg, ':', 1));
    end;
  end if;
  v_dir_ok := dir is not null or coalesce(v_ent ->> 'tipo', '') = 'recoge';   -- recoger en sucursal no necesita domicilio
  if not v_dir_ok then problemas := problemas || '"REQUIERE_DIRECCION"'::jsonb; end if;
  -- C360-0 · identidad comercial canónica (perfil → customers.id). Sin cliente vinculado no hay revisión lista.
  v_cust := public._cc_chk_customer(v_uid);
  if v_cust is null then problemas := problemas || '"CLIENTE_NO_VINCULADO"'::jsonb; end if;
  if (prep ->> 'listo')::boolean and (lin ->> 'ok')::boolean and v_dir_ok and v_ent is not null and v_cust is not null then
    v_exp := now() + interval '15 minutes';   -- D-CC6-01
    insert into public.cc_checkout_reviews (cart_id, profile_id, cart_rev, fingerprint, total, n_items, location_id, direccion, entrega, expires_at)
    values (c.id, v_uid, c.rev, lin ->> 'fingerprint', (lin ->> 'total')::numeric, (lin ->> 'n_items')::int, (dir ->> 'location_id')::uuid, dir -> 'address', v_ent, v_exp) returning id into rv;
    perform public._cc_chk_evento(c.id, rv, v_uid, 'review_created', jsonb_build_object('rev', c.rev, 'n_items', lin ->> 'n_items'));
    return jsonb_build_object('listo', true, 'cart_id', c.id, 'cart_rev', c.rev, 'review_id', rv, 'expires_at', v_exp, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                              'lineas', lin -> 'lineas', 'direccion', dir, 'proyeccion', prep -> 'proyeccion', 'problemas', '[]'::jsonb,
                              'entrega', v_ent, 'entrega_opciones', v_ops, 'envio', (v_ent ->> 'flete')::numeric, 'total_con_envio', (lin ->> 'total')::numeric + (v_ent ->> 'flete')::numeric);
  end if;
  perform public._cc_chk_evento(c.id, null, v_uid, 'review_not_ready', jsonb_build_object('n', jsonb_array_length(problemas)));
  return jsonb_build_object('listo', false, 'cart_id', c.id, 'cart_rev', c.rev, 'problemas', problemas || coalesce(lin -> 'problemas', '[]'::jsonb), 'proyeccion', prep -> 'proyeccion', 'direccion', dir, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                            'entrega', v_ent, 'entrega_opciones', v_ops);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false, p_perfil_fiscal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb; v_cust uuid; v_fiscal jsonb; v_ent jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_operation is null or p_operation !~ '^[A-Za-z0-9:_.-]{1,120}$' then raise exception 'OPERACION_INVALIDA' using errcode = 'check_violation'; end if;
  select * into r from public.cc_checkout_reviews where id = p_review for update;
  if not found or r.profile_id <> v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- un review_id conocido no da acceso
  select * into c from public.cc_carts where id = r.cart_id for update;
  if c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);

  -- Libro de operaciones: misma operación → mismo resultado; mismo id con otra revisión → conflicto.
  select * into op from public.cc_checkout_operations where cart_id = c.id and operation_id = p_operation;
  if found then
    if op.review_id <> r.id then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
    return public._cc_chk_resultado(op.order_id, c.id, true);
  end if;
  -- Ya convertido (por otra operación/revisión): devolver el pedido existente, nunca crear otro.
  if c.estado = 'converted' then return public._cc_chk_resultado(c.converted_order_id, c.id, true) || jsonb_build_object('motivo', 'YA_CONVERTIDO'); end if;
  if c.estado <> 'active' then raise exception 'CARRITO_CERRADO: %', c.estado using errcode = 'check_violation'; end if;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_attempted', jsonb_build_object('rev', c.rev));

  if r.consumed_at is not null then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_consumed');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_CONSUMIDA', 'cart_id', c.id);
  end if;
  if r.expires_at < now() then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_expired');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_EXPIRADA', 'cart_id', c.id);
  end if;
  if r.cart_rev <> c.rev or (p_expected_rev is not null and p_expected_rev <> c.rev) then   -- D-CC6-03: cualquier cambio del carrito invalida la revisión
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_changed_cart', jsonb_build_object('rev_revisada', r.cart_rev, 'rev_actual', c.rev));
    return jsonb_build_object('confirmado', false, 'motivo', 'CARRITO_CAMBIO', 'cart_id', c.id, 'cart_rev', c.rev, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Revalidación TOTAL con la autoridad actual (precio, visibilidad, cantidades, disponibilidad).
  lin := public._cc_chk_lineas(c.id, v_uid);
  if not (lin ->> 'ok')::boolean then
    perform public._cc_chk_evento(c.id, r.id, v_uid, case when lin -> 'problemas' @> '[{"problema":"SIN_DISPONIBILIDAD"}]' or (lin -> 'problemas')::text like '%SIN_DISPONIBILIDAD%' then 'confirmation_rejected_stock' else 'confirmation_rejected_product' end, jsonb_build_object('n', jsonb_array_length(lin -> 'problemas')));
    return jsonb_build_object('confirmado', false, 'motivo', 'NO_LISTO', 'problemas', lin -> 'problemas', 'cart_id', c.id, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;
  if lin ->> 'fingerprint' <> r.fingerprint then   -- mismo rev ⇒ mismos productos/cantidades ⇒ cambió el precio (D-CC6-02: no se compra en silencio)
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_price_changed', jsonb_build_object('total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric));
    return jsonb_build_object('confirmado', false, 'motivo', 'PRECIO_CAMBIO', 'cart_id', c.id, 'total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric, 'lineas', lin -> 'lineas', 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Inyección de fallos SOLO para pruebas (GUC de sesión; un cliente PostgREST no puede fijarlo).
  v_fallo := current_setting('app.cc_checkout_fallar', true);
  if v_fallo = 'antes_w1' then raise exception 'FALLO_INYECTADO: antes_w1'; end if;

  -- W1: el pedido canónico. Precio e items los pone crear_pedido (precio_de con la lista del doctor); folio del servidor.
  -- C360-0 · identidad comercial CANÓNICA del pedido: perfil autenticado → customers.id (uq_customers_profile).
  -- Nunca del cliente, del correo ni de seller_name. Sin cliente vinculado y activo: FALLA CERRADO, sin pedido.
  v_cust := public._cc_chk_customer(v_uid);
  if v_cust is null then
    raise exception 'CLIENTE_NO_VINCULADO: tu cuenta no está ligada a un expediente de cliente activo' using errcode = 'check_violation';
  end if;
  -- C360-F3 · receptor fiscal: el perfil ELEGIDO (debe ser de este cliente y estar activo) o el predeterminado.
  -- Se valida ANTES del pedido; se congela en el pedido como snapshot (W3 sigue desde ese receptor).
  if coalesce(p_factura, false) then
    if p_perfil_fiscal is not null then
      select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_fiscal
        from public.customer_fiscal_profiles f where f.id = p_perfil_fiscal and f.customer_id = v_cust and f.activo;
      if v_fiscal is null then raise exception 'PERFIL_FISCAL_INVALIDO: ese perfil fiscal no es tuyo o está archivado' using errcode = 'check_violation'; end if;
    else
      select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_fiscal
        from public.customer_fiscal_profiles f where f.customer_id = v_cust and f.es_predeterminado and f.activo;
    end if;
  end if;
  -- ENT-0 · la entrega revisada se vuelve a calcular con la hora de AHORA (el corte pudo pasar); la opción es la revisada.
  -- Revisiones anteriores a la 171 (sin entrega): recoger en sucursal, sin cargo.
  v_ent := public._entrega_normalizar('doctor', (lin ->> 'total')::numeric, r.direccion ->> 'cp', jsonb_build_object('opcion', coalesce(r.entrega ->> 'opcion', 'recoge')), now());
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (metadata server-derived; NO es comisión ni autoridad económica): CC-7 · la cartera canónica (cc_cartera) o ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  -- CX-0c · D5: marca de procedencia LIGADA A ESTE PEDIDO (transaccional). crear_pedido solo pone «Checkout canónico
  -- (CC-6)» si coincide con su p_order_id; se borra al volver. La atribución (seller*) y placed_by los decide crear_pedido.
  perform set_config('app.cc_checkout_pedido', v_order::text, true);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, coalesce(p_factura, false), v_cust);
  perform set_config('app.cc_checkout_pedido', '', true);
  if coalesce((w1 ->> 'order_id')::uuid, v_order) <> v_order then raise exception 'W1_INCONSISTENTE'; end if;
  if v_fallo = 'despues_w1' then raise exception 'FALLO_INYECTADO: despues_w1'; end if;   -- prueba: nada queda a medias
  perform public._entrega_aplicar(v_order, v_ent);   -- ENT-0 · flete y promesa en el pedido, misma transacción
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric + (v_ent ->> 'flete')::numeric));
  if v_fiscal is not null then perform public.set_order_fiscal_snapshot(v_order, v_fiscal); end if;   -- C360-F3 · receptor congelado

  update public.cc_carts set estado = 'converted', converted_order_id = v_order, closed_at = now(), rev = rev + 1, updated_at = now(), last_activity_at = now() where id = c.id;
  perform public._cc_cart_evento(c.id, 'converted', 'doctor', v_uid, null, null, null, null, jsonb_build_object('order_id', v_order));
  update public.cc_checkout_reviews set consumed_at = now(), order_id = v_order where id = r.id;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'cart_converted', jsonb_build_object('order_id', v_order));
  if v_fallo = 'antes_operacion' then raise exception 'FALLO_INYECTADO: antes_operacion'; end if;
  res := public._cc_chk_resultado(v_order, c.id, false);
  insert into public.cc_checkout_operations (cart_id, operation_id, profile_id, review_id, order_id, resultado) values (c.id, p_operation, v_uid, r.id, v_order, res);
  return res;
end;
$function$;

-- El resultado del checkout lleva la entrega (promesa y flete) para que el portal la muestre al instante.
CREATE OR REPLACE FUNCTION public._cc_chk_resultado(p_order uuid, p_cart uuid, p_idem boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('confirmado', true, 'idempotente', p_idem, 'cart_id', p_cart, 'order_id', o.id, 'folio', o.external_ref, 'status', o.status, 'total', o.total, 'moneda', coalesce(o.currency, 'MXN'),
           'estado_pago', coalesce(m.estado_pago, 'pending'), 'saldo', coalesce(m.saldo, o.total),
           'acciones_pago', jsonb_build_array('transferencia', 'tarjeta'),   -- métodos permitidos hoy (reportar transferencia / Stripe); la verdad de pago sigue en W2
           'created_at', o.created_at, 'envio', o.shipping_cost, 'entrega', o.shipping_meta -> 'entrega')
    from public.orders o left join public.v_order_money m on m.order_id = o.id where o.id = p_order
$function$;

-- ---------------------------------------------------------------------------------------------------
-- 8) CONFIGURACIÓN: leer (personal y doctores, para mostrar la regla) y guardar (solo Dirección).
-- ---------------------------------------------------------------------------------------------------
create function public.entrega_config_ver() returns jsonb
  language sql stable security definer set search_path = public as
$$ select to_jsonb(c) - 'id' - 'updated_by' from public.entrega_config c where c.id = 1 and auth.uid() is not null $$;

create function public.entrega_config_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg public.entrega_config%rowtype;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección cambia la regla de entrega' using errcode = 'insufficient_privilege'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 4000 then raise exception 'ENTREGA_CONFIG_INVALIDA' using errcode = 'check_violation'; end if;
  select * into cfg from public.entrega_config where id = 1 for update;
  update public.entrega_config set
    corte                = coalesce((p ->> 'corte')::time, cfg.corte),
    foraneo_gratis_desde = coalesce((p ->> 'foraneo_gratis_desde')::numeric, cfg.foraneo_gratis_desde),
    foraneo_costo        = coalesce((p ->> 'foraneo_costo')::numeric, cfg.foraneo_costo),
    local_gratis_desde   = coalesce((p ->> 'local_gratis_desde')::numeric, cfg.local_gratis_desde),
    local_costo          = coalesce((p ->> 'local_costo')::numeric, cfg.local_costo),
    cp_local_desde       = coalesce(p ->> 'cp_local_desde', cfg.cp_local_desde),
    cp_local_hasta       = coalesce(p ->> 'cp_local_hasta', cfg.cp_local_hasta),
    dias_paqueteria      = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_paqueteria') x), cfg.dias_paqueteria),
    dias_chofer          = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_chofer') x), cfg.dias_chofer),
    dias_entrega_foranea = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_entrega_foranea') x), cfg.dias_entrega_foranea),
    dhl_transito_min     = coalesce((p ->> 'dhl_transito_min')::smallint, cfg.dhl_transito_min),
    dhl_transito_max     = coalesce((p ->> 'dhl_transito_max')::smallint, cfg.dhl_transito_max),
    t1_activo            = coalesce((p ->> 't1_activo')::boolean, cfg.t1_activo),
    t1_transito_min      = coalesce((p ->> 't1_transito_min')::smallint, cfg.t1_transito_min),
    t1_transito_max      = coalesce((p ->> 't1_transito_max')::smallint, cfg.t1_transito_max),
    local_mismo_dia      = coalesce((p ->> 'local_mismo_dia')::boolean, cfg.local_mismo_dia),
    recoge_lugar         = coalesce(nullif(btrim(p ->> 'recoge_lugar'), ''), cfg.recoge_lugar),
    recoge_horario       = coalesce(nullif(btrim(p ->> 'recoge_horario'), ''), cfg.recoge_horario),
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  perform public.log_audit('Regla de entrega actualizada', 'entrega_config', left(p::text, 1000), 'Dirección');
  return public.entrega_config_ver();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9) Permisos.
-- ---------------------------------------------------------------------------------------------------
alter function public._entrega_zona() owner to postgres;
alter function public._entrega_dia_valido(date, smallint[]) owner to postgres;
alter function public._entrega_siguiente_dia(date, smallint[]) owner to postgres;
alter function public._entrega_sumar_dias(date, int, smallint[]) owner to postgres;
alter function public._entrega_salida(timestamptz, smallint[]) owner to postgres;
alter function public._entrega_es_local(text) owner to postgres;
alter function public._entrega_opcion(text, text, text, numeric, boolean, text, boolean, jsonb, date, date, text) owner to postgres;
alter function public.entrega_opciones(text, numeric, text, timestamptz) owner to postgres;
alter function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) owner to postgres;
alter function public._entrega_aplicar(uuid, jsonb) owner to postgres;
alter function public._orders_shipping_cost_guard() owner to postgres;
alter function public.crear_pedido_con_entrega(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb) owner to postgres;
alter function public.entrega_config_ver() owner to postgres;
alter function public.entrega_config_guardar(jsonb) owner to postgres;
revoke all on function public._entrega_zona(), public._entrega_dia_valido(date, smallint[]), public._entrega_siguiente_dia(date, smallint[]), public._entrega_sumar_dias(date, int, smallint[]),
  public._entrega_salida(timestamptz, smallint[]), public._entrega_es_local(text), public._entrega_opcion(text, text, text, numeric, boolean, text, boolean, jsonb, date, date, text), public._entrega_normalizar(text, numeric, text, jsonb, timestamptz), public._entrega_aplicar(uuid, jsonb), public._orders_shipping_cost_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.entrega_opciones(text, numeric, text, timestamptz), public.crear_pedido_con_entrega(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb),
  public.entrega_config_ver(), public.entrega_config_guardar(jsonb) from public, anon;
grant execute on function public.entrega_opciones(text, numeric, text, timestamptz), public.entrega_config_ver(), public.entrega_config_guardar(jsonb) to authenticated;
grant execute on function public.crear_pedido_con_entrega(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb) to authenticated, service_role;   -- mismos permisos que crear_pedido_con_receptor
revoke all on function public.cc_checkout_revisar(uuid, uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.cc_checkout_revisar(uuid, uuid, jsonb, jsonb) to authenticated;
comment on function public.crear_pedido_con_entrega(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb) is 'ENT-0 · Pedido (crear_pedido_con_receptor, sin cambios) + entrega validada por el servidor (tipo, paquetería, flete, promesa) en una transacción.';
comment on function public.entrega_opciones(text, numeric, text, timestamptz) is 'ENT-0 · Opciones de entrega para un importe y un CP: doctor (regla estricta) o staff (todas, con costo propuesto).';

do $post$ begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cc_checkout_revisar', 'cc_checkout_confirmar')) <> 2 then raise exception 'ENTREGA: quedaron firmas duplicadas del checkout'; end if;
  if has_function_privilege('anon', 'public.entrega_opciones(text,numeric,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public._entrega_aplicar(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)', 'execute')
     or has_table_privilege('authenticated', 'public.entrega_config', 'select')
     or not has_function_privilege('authenticated', 'public.crear_pedido_con_entrega(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb,jsonb)', 'execute') then
    raise exception 'ENTREGA: permisos inesperados';
  end if;
  if (select count(*) from public.entrega_config) <> 1 then raise exception 'ENTREGA: falta la configuración'; end if;
  if md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) <> '5769c551e6ca60003ba0fcf9390d80d1'
     or md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> 'bee5aa3614e2b9e0327ebec6a1b38e2e' then
    raise exception 'ENTREGA: crear_pedido / crear_pedido_con_receptor cambiaron (no debían)';
  end if;
end $post$;
