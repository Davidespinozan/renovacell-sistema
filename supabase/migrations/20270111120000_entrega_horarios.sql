-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HORARIO DE ENTREGA LOCAL (migración 189) · ENT-H: LA ENTREGA POR CHOFER SE AGENDA EN UN HORARIO DISPONIBLE
--   Pedido del dueño (22 oct 2026): "a la hora de generar una venta —punto de venta, evento, portal del doctor o por
--   donde sea que se pueda vender— la entrega local tiene que seleccionar un horario disponible: de 10:30 a 1:30 y de
--   3:30 a 5:30, cada 30 minutos; se tienen que poder ver los horarios disponibles; si alguien elige un horario se
--   bloquea; y Almacén, Chofer y Dirección ven los horarios de entregas locales".
--   Decisiones: los bloques y el intervalo viven en entrega_config (Dirección los edita); un horario = [inicio, fin) de
--   30 min; cupo por horario = 1 (configurable); el mismo día solo se ofrecen horarios que empiezan ≥ 60 min después de
--   ahora (configurable) y solo si el pedido entra antes del corte (la regla de la 171 sigue decidiendo el día de salida);
--   se ofrecen 7 días hacia adelante (configurable); la reserva se escribe en la MISMA transacción que el pedido (si el
--   horario se ocupó un segundo antes, el pedido NO se crea); cancelar el pedido libera el horario; Almacén/Dirección
--   pueden reprogramar con motivo; el doctor en su portal elige el horario igual que el vendedor.
--   · entrega_config.horario_*        bloques (franjas), intervalo, cupo, margen del mismo día, días hacia adelante.
--   · entrega_horarios                 la agenda: una fila por reserva (pedido, fecha, inicio, fin, estado).
--   · entrega_horarios_disponibles     lo que puede elegir quien vende: días y horarios con disponible/ocupado/pasado.
--   · _entrega_horario_validar         el servidor valida el horario elegido (existe, día válido, no pasado, con cupo).
--   · _entrega_normalizar              (171, redefinida) la entrega local por chofer EXIGE horario; la promesa es ese día.
--   · _entrega_aplicar                 (171, redefinida) reserva el horario con candado (cupo) en la transacción del pedido.
--   · cc_checkout_revisar/confirmar    (171, redefinidas) pasan el horario elegido al normalizar (solo ese cambio).
--   · entrega_horarios_agenda          Dirección, Almacén/Empaque y Chofer ven las entregas locales por día y horario.
--   · entrega_horario_reprogramar      Dirección/Almacén mueven una entrega a otro horario, con motivo y bitácora.
--   · entrega_config_guardar           (171, redefinida) acepta los campos horario_*.
--   · trigger orders → cancelado       libera la reserva del pedido.
--   NO cambia: entrega_opciones (misma forma), crear_pedido_con_entrega, crear_pedido, vender_pos, paquetería, Empaque.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.entrega_horarios') is not null then raise exception 'ENT-H: ya aplicada'; end if;
  if to_regclass('public.entrega_config') is null then raise exception 'ENT-H: falta la 171'; end if;
  if md5(pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure)) <> '13545a870c138acf7ca42f37601f91a6' then raise exception 'ENT-H: _entrega_normalizar no es la versión de la 171'; end if;
  if md5(pg_get_functiondef('public._entrega_aplicar(uuid,jsonb)'::regprocedure)) <> 'a43d00fde28d523d0592ec5e69945eef' then raise exception 'ENT-H: _entrega_aplicar no es la versión de la 171'; end if;
  if md5(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb,jsonb)'::regprocedure)) <> 'f98ff78b8a1c3e878c82f39455c61bf1' then raise exception 'ENT-H: cc_checkout_revisar no es la versión de la 171'; end if;
  if md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) <> '10a47072077ba2c8d77702b5e2de7648' then raise exception 'ENT-H: cc_checkout_confirmar no es la versión de la 171'; end if;
  if md5(pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure)) <> '29fae3bc5f34070f96f00c4b5d97aea9' then raise exception 'ENT-H: entrega_config_guardar no es la versión de la 171'; end if;
end $pre$;

-- ---------------------------------------------------------------------------------------------------
-- 1) CONFIGURACIÓN: bloques de entrega, intervalo, cupo, margen y días hacia adelante.
-- ---------------------------------------------------------------------------------------------------
create function public._entrega_franjas_validas(p jsonb) returns boolean
  language sql immutable as
$$
  select p is not null and jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 6
     and not exists (
       select 1 from jsonb_array_elements(p) f
        where jsonb_typeof(f) <> 'object'
           or coalesce(f ->> 'desde', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           or coalesce(f ->> 'hasta', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           or (f ->> 'desde')::time >= (f ->> 'hasta')::time)
$$;

alter table public.entrega_config
  add column horario_franjas       jsonb    not null default '[{"desde":"10:30","hasta":"13:30"},{"desde":"15:30","hasta":"17:30"}]'::jsonb,
  add column horario_intervalo_min smallint not null default 30 constraint ck_entcfg_intervalo check (horario_intervalo_min between 10 and 120),
  add column horario_cupo          smallint not null default 1  constraint ck_entcfg_cupo check (horario_cupo between 1 and 20),
  add column horario_margen_min    smallint not null default 60 constraint ck_entcfg_margen check (horario_margen_min between 0 and 480),
  add column horario_dias_adelante smallint not null default 7  constraint ck_entcfg_dias_adelante check (horario_dias_adelante between 1 and 30),
  add constraint ck_entcfg_franjas check (public._entrega_franjas_validas(horario_franjas));
comment on column public.entrega_config.horario_franjas is 'ENT-H · bloques del día en que el chofer entrega ([{desde,hasta}], HH:MM); los horarios se generan cada horario_intervalo_min dentro de cada bloque.';
comment on column public.entrega_config.horario_cupo is 'ENT-H · entregas que caben en un mismo horario (1 = al elegirlo se bloquea).';
comment on column public.entrega_config.horario_margen_min is 'ENT-H · el mismo día solo se ofrecen horarios que empiezan al menos estos minutos después de ahora.';

-- ---------------------------------------------------------------------------------------------------
-- 2) LA AGENDA: una fila por reserva. Solo la escriben los comandos del servidor; se lee con entrega_horarios_agenda.
-- ---------------------------------------------------------------------------------------------------
create table public.entrega_horarios (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  fecha              date not null,
  inicio             time not null,
  fin                time not null,
  estado             text not null default 'reservado' constraint ck_enth_estado check (estado in ('reservado', 'liberado')),
  motivo_liberacion  text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  liberado_at        timestamptz,
  constraint ck_enth_rango check (inicio < fin)
);
create unique index uq_entrega_horarios_pedido_activo on public.entrega_horarios (order_id) where estado = 'reservado';
create index ix_entrega_horarios_fecha on public.entrega_horarios (fecha, inicio) where estado = 'reservado';
comment on table public.entrega_horarios is 'ENT-H · agenda de entregas locales: la reserva del horario de cada pedido (reservado | liberado).';
alter table public.entrega_horarios enable row level security;
revoke all on public.entrega_horarios from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3) HORARIOS DEL DÍA (de la configuración) y disponibilidad.
-- ---------------------------------------------------------------------------------------------------
create function public._entrega_horario_slots() returns table (inicio time, fin time)
  language sql stable set search_path = public as
$$
  select s::time as inicio, (s + make_interval(mins => c.horario_intervalo_min))::time as fin
    from public.entrega_config c,
         jsonb_array_elements(c.horario_franjas) f,
         generate_series(('2000-01-01 ' || (f ->> 'desde'))::timestamp,
                         ('2000-01-01 ' || (f ->> 'hasta'))::timestamp - make_interval(mins => c.horario_intervalo_min),
                         make_interval(mins => c.horario_intervalo_min)) s
   where c.id = 1
   order by 1
$$;

create function public._entrega_horario_ocupados(p_fecha date, p_inicio time) returns int
  language sql stable set search_path = public as
$$ select count(*)::int from public.entrega_horarios h where h.fecha = p_fecha and h.inicio = p_inicio and h.estado = 'reservado' $$;

/** Último día que se ofrece: horario_dias_adelante días válidos del chofer contando desde la salida. */
create function public._entrega_horario_ultimo_dia(p_salida date) returns date
  language sql stable set search_path = public as
$$ select public._entrega_sumar_dias(p_salida, c.horario_dias_adelante - 1, c.dias_chofer) from public.entrega_config c where c.id = 1 $$;

-- Lo que ve quien vende (doctor o personal): días desde la salida del chofer y, por día, cada horario con su estado.
create function public.entrega_horarios_disponibles(p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare cfg public.entrega_config%rowtype; s_cho jsonb; loc timestamp; hoy date; salida date; d date; n int := 0; dias jsonb := '[]'::jsonb; slots jsonb; limite time;
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into cfg from public.entrega_config where id = 1;
  s_cho := public._entrega_salida(p_ahora, cfg.dias_chofer);
  loc := p_ahora at time zone public._entrega_zona(); hoy := loc::date; salida := (s_cho ->> 'salida')::date;
  limite := (loc + make_interval(mins => cfg.horario_margen_min))::time;
  d := salida;
  while n < cfg.horario_dias_adelante and d <= salida + 90 loop
    if public._entrega_dia_valido(d, cfg.dias_chofer) then
      select coalesce(jsonb_agg(jsonb_build_object(
               'inicio', to_char(s.inicio, 'HH24:MI'), 'fin', to_char(s.fin, 'HH24:MI'),
               'ocupados', o.n, 'cupo', cfg.horario_cupo,
               'disponible', o.n < cfg.horario_cupo and (d > hoy or s.inicio >= limite),
               'motivo', case when o.n >= cfg.horario_cupo then 'OCUPADO' when d = hoy and s.inicio < limite then 'PASADO' end) order by s.inicio), '[]'::jsonb)
        into slots
        from public._entrega_horario_slots() s, lateral (select public._entrega_horario_ocupados(d, s.inicio) as n) o;
      dias := dias || jsonb_build_object('fecha', d, 'dia_semana', extract(isodow from d)::int, 'slots', slots,
                                         'disponibles', (select count(*) from jsonb_array_elements(slots) x where (x ->> 'disponible')::boolean));
      n := n + 1;
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('zona', public._entrega_zona(), 'hoy', hoy, 'ahora', to_char(loc, 'HH24:MI'), 'salida', salida,
                            'antes_de_corte', (s_cho ->> 'antes_de_corte')::boolean, 'corte', s_cho ->> 'corte',
                            'cupo', cfg.horario_cupo, 'intervalo_min', cfg.horario_intervalo_min, 'margen_min', cfg.horario_margen_min,
                            'franjas', cfg.horario_franjas, 'dias', dias);
end;
$$;

-- Valida el horario que mandó quien pide. Estricto (venta): fecha ≥ salida y, el mismo día, inicio ≥ ahora + margen.
-- No estricto (reprogramar desde Almacén/Dirección): fecha ≥ hoy y, hoy, inicio > ahora (el chofer puede salir ya).
create function public._entrega_horario_validar(p_fecha text, p_inicio text, p_ahora timestamptz default now(), p_estricto boolean default true) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare cfg public.entrega_config%rowtype; s_cho jsonb; loc timestamp; hoy date; salida date; f date; i time; fin time; ult date;
begin
  if nullif(btrim(coalesce(p_fecha, '')), '') is null or nullif(btrim(coalesce(p_inicio, '')), '') is null then
    raise exception 'HORARIO_REQUERIDO: la entrega local necesita un horario de entrega' using errcode = 'check_violation';
  end if;
  if p_fecha !~ '^\d{4}-\d{2}-\d{2}$' or p_inicio !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then
    raise exception 'HORARIO_INVALIDO: horario de entrega desconocido' using errcode = 'check_violation';
  end if;
  begin f := p_fecha::date; exception when others then raise exception 'HORARIO_INVALIDO: fecha de entrega inválida' using errcode = 'check_violation'; end;
  i := left(p_inicio, 5)::time;
  select s.fin into fin from public._entrega_horario_slots() s where s.inicio = i;
  if fin is null then raise exception 'HORARIO_INVALIDO: ese horario no existe en los bloques de entrega' using errcode = 'check_violation'; end if;
  select * into cfg from public.entrega_config where id = 1;
  if not public._entrega_dia_valido(f, cfg.dias_chofer) then raise exception 'HORARIO_DIA_NO_VALIDO: ese día el chofer no entrega' using errcode = 'check_violation'; end if;
  s_cho := public._entrega_salida(p_ahora, cfg.dias_chofer);
  loc := p_ahora at time zone public._entrega_zona(); hoy := loc::date; salida := (s_cho ->> 'salida')::date;
  if p_estricto then
    if f < salida then raise exception 'HORARIO_PASADO: ese horario ya pasó o el pedido ya no sale ese día' using errcode = 'check_violation'; end if;
    if f = hoy and i < (loc + make_interval(mins => cfg.horario_margen_min))::time then raise exception 'HORARIO_PASADO: ese horario ya está muy cerca; elige uno más tarde' using errcode = 'check_violation'; end if;
    ult := public._entrega_horario_ultimo_dia(salida);
    if f > ult then raise exception 'HORARIO_LEJANO: solo se agendan entregas hasta el %', to_char(ult, 'DD/MM') using errcode = 'check_violation'; end if;
  else
    if f < hoy or (f = hoy and i <= loc::time) then raise exception 'HORARIO_PASADO: ese horario ya pasó' using errcode = 'check_violation'; end if;
    if f > hoy + 60 then raise exception 'HORARIO_LEJANO: demasiado lejos' using errcode = 'check_violation'; end if;
  end if;
  if public._entrega_horario_ocupados(f, i) >= cfg.horario_cupo then raise exception 'HORARIO_OCUPADO: ese horario de entrega ya está ocupado; elige otro' using errcode = 'check_violation'; end if;
  return jsonb_build_object('fecha', f, 'inicio', to_char(i, 'HH24:MI'), 'fin', to_char(fin, 'HH24:MI'), 'etiqueta', to_char(i, 'HH24:MI') || '–' || to_char(fin, 'HH24:MI'));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4) NORMALIZAR (171, redefinida): la entrega local por chofer exige horario; la promesa de llegada es ese día.
--    Idéntica a la 171 salvo el bloque ENT-H.
-- ---------------------------------------------------------------------------------------------------
create or replace function public._entrega_normalizar(p_actor text, p_subtotal numeric, p_cp text, p_eleccion jsonb, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare ops jsonb; o jsonb; v_id text; v_costo numeric; v_motivo text; cfg public.entrega_config%rowtype; v_hor jsonb;
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
  -- ENT-H · entrega local por chofer: el horario elegido se valida aquí (existe, día válido, no pasado, con cupo).
  if o ->> 'tipo' = 'local' and o ->> 'paqueteria' = 'chofer' then
    v_hor := public._entrega_horario_validar(p_eleccion -> 'horario' ->> 'fecha', p_eleccion -> 'horario' ->> 'inicio', p_ahora, true);
  end if;
  select * into cfg from public.entrega_config where id = 1;
  return jsonb_strip_nulls(jsonb_build_object(
    'opcion', o ->> 'id', 'tipo', o ->> 'tipo', 'paqueteria', o -> 'paqueteria', 'texto', o ->> 'texto',
    'flete', v_costo, 'flete_regla', (o ->> 'flete')::numeric, 'ajuste_motivo', v_motivo,
    'local', ops -> 'local', 'cp', ops -> 'cp', 'subtotal', ops -> 'subtotal',
    'salida', o -> 'salida', 'antes_de_corte', o -> 'antes_de_corte',
    'llega_desde', coalesce(v_hor -> 'fecha', o -> 'llega_desde'), 'llega_hasta', coalesce(v_hor -> 'fecha', o -> 'llega_hasta'),
    'horario', v_hor,
    'recoge', case when o ->> 'tipo' = 'recoge' then jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario) end,
    'actor', p_actor, 'calculado_at', p_ahora));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5) APLICAR (171, redefinida): además de flete y promesa, RESERVA el horario con candado por (fecha, inicio).
--    Si el cupo se agotó entre elegir y confirmar, la excepción deshace el pedido completo (misma transacción).
-- ---------------------------------------------------------------------------------------------------
create or replace function public._entrega_aplicar(p_order uuid, p_entrega jsonb) returns void
  language plpgsql set search_path = public as
$$
declare o record; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_costo numeric := (p_entrega ->> 'flete')::numeric;
        v_f date; v_i time; v_fin time; v_cupo smallint;
begin
  select id, shipping_cost, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.shipping_meta ? 'entrega' then
    if o.shipping_meta -> 'entrega' ->> 'opcion' = p_entrega ->> 'opcion' and o.shipping_cost = v_costo then return; end if;   -- ya aplicada (reintento)
    raise exception 'ENTREGA_YA_FIJADA: la entrega del pedido ya quedó registrada' using errcode = 'check_violation';
  end if;
  -- ENT-H · reserva del horario (entrega local por chofer). Candado por horario: dos pedidos al mismo horario se serializan.
  if p_entrega ? 'horario' then
    v_f := (p_entrega -> 'horario' ->> 'fecha')::date; v_i := (p_entrega -> 'horario' ->> 'inicio')::time; v_fin := (p_entrega -> 'horario' ->> 'fin')::time;
    perform pg_advisory_xact_lock(hashtext('entrega_horario'), hashtext(v_f::text || ' ' || v_i::text));
    select horario_cupo into v_cupo from public.entrega_config where id = 1;
    if public._entrega_horario_ocupados(v_f, v_i) >= v_cupo then
      raise exception 'HORARIO_OCUPADO: ese horario de entrega ya está ocupado; elige otro' using errcode = 'check_violation';
    end if;
    insert into public.entrega_horarios (order_id, fecha, inicio, fin, created_by) values (p_order, v_f, v_i, v_fin, auth.uid());
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set shipping_cost = v_costo, total = coalesce(total, 0) + v_costo,
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('entrega', p_entrega)
   where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
end;
$$;

-- Cancelar el pedido libera su horario (cualquier vía: cancelar_pedido, vencimiento sin pago, Dirección).
create function public._entrega_horarios_liberar_trg() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.entrega_horarios set estado = 'liberado', liberado_at = now(), motivo_liberacion = 'Pedido cancelado'
     where order_id = new.id and estado = 'reservado';
  end if;
  return new;
end;
$$;
create trigger orders_entrega_horario_liberar after update of status on public.orders for each row execute function public._entrega_horarios_liberar_trg();

-- ---------------------------------------------------------------------------------------------------
-- 6) CHECKOUT DEL DOCTOR (171, redefinidas): el horario elegido viaja al normalizar. Texto de la 171 con UN cambio cada una.
-- ---------------------------------------------------------------------------------------------------
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
      v_ent := public._entrega_normalizar('doctor', coalesce((lin ->> 'total')::numeric, 0), dir -> 'address' ->> 'cp', jsonb_build_object('opcion', v_elec, 'horario', p_entrega -> 'horario'), now());   -- ENT-H · el horario elegido viaja con la opción
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
  v_ent := public._entrega_normalizar('doctor', (lin ->> 'total')::numeric, r.direccion ->> 'cp', jsonb_build_object('opcion', coalesce(r.entrega ->> 'opcion', 'recoge'), 'horario', r.entrega -> 'horario'), now());   -- ENT-H · el horario revisado se vuelve a validar (cupo) al confirmar
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

-- ---------------------------------------------------------------------------------------------------
-- 7) AGENDA: Dirección, Almacén/Empaque y Chofer ven las entregas locales por día y horario.
-- ---------------------------------------------------------------------------------------------------
create function public.entrega_horarios_agenda(p_desde date default null, p_hasta date default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); cfg public.entrega_config%rowtype; hoy date; d1 date; d2 date; d date; dias jsonb := '[]'::jsonb; slots jsonb;
begin
  if v_rol not in ('admin', 'warehouse', 'packing', 'driver') then raise exception 'NO_AUTORIZADO: la agenda de entregas es de Dirección, Almacén y Chofer' using errcode = 'insufficient_privilege'; end if;
  select * into cfg from public.entrega_config where id = 1;
  hoy := (now() at time zone public._entrega_zona())::date;
  d1 := coalesce(p_desde, hoy); d2 := coalesce(p_hasta, d1 + 6);
  if d2 < d1 then d2 := d1; end if;
  if d2 > d1 + 30 then raise exception 'RANGO_INVALIDO: máximo 31 días' using errcode = 'check_violation'; end if;
  d := d1;
  while d <= d2 loop
    if public._entrega_dia_valido(d, cfg.dias_chofer) or exists (select 1 from public.entrega_horarios h where h.fecha = d and h.estado = 'reservado') then
      select coalesce(jsonb_agg(jsonb_build_object(
               'inicio', to_char(s.inicio, 'HH24:MI'), 'fin', to_char(s.fin, 'HH24:MI'), 'cupo', cfg.horario_cupo,
               'pedidos', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'order_id', o.id, 'folio', o.external_ref, 'estado_pedido', o.status, 'pagado', o.payment_status = 'paid',
                          'cliente', coalesce(o.shipping_meta -> 'customer' ->> 'name', c.full_name, pr.full_name, 'Cliente'),
                          'telefono', coalesce(o.shipping_meta -> 'address' ->> 'phone', c.phone),
                          'direccion', o.shipping_meta -> 'address',
                          'flete', o.shipping_cost, 'total', o.total,
                          'envio_estado', sh.status, 'chofer', coalesce(dp.meta ->> 'name', dp.full_name),
                          'reservado_at', h.created_at) order by h.created_at)
                   from public.entrega_horarios h
                   join public.orders o on o.id = h.order_id
                   left join public.customers c on c.id = o.customer_id
                   left join public.profiles pr on pr.id = o.doctor_id
                   left join lateral (select s2.status, s2.driver_id from public.shipments s2 where s2.order_id = o.id order by s2.created_at desc limit 1) sh on true
                   left join public.profiles dp on dp.id = sh.driver_id
                  where h.fecha = d and h.inicio = s.inicio and h.estado = 'reservado'), '[]'::jsonb)) order by s.inicio), '[]'::jsonb)
        into slots
        from public._entrega_horario_slots() s;
      dias := dias || jsonb_build_object('fecha', d, 'dia_semana', extract(isodow from d)::int, 'hoy', d = hoy, 'slots', slots,
                                         'entregas', (select count(*) from public.entrega_horarios h where h.fecha = d and h.estado = 'reservado'));
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('desde', d1, 'hasta', d2, 'hoy', hoy, 'zona', public._entrega_zona(), 'cupo', cfg.horario_cupo, 'dias', dias);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8) REPROGRAMAR (Dirección y Almacén): mover una entrega local a otro horario, con motivo y bitácora.
-- ---------------------------------------------------------------------------------------------------
create function public.entrega_horario_reprogramar(p_order uuid, p_fecha text, p_inicio text, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); o record; v_hor jsonb; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_motivo text; v_ant jsonb; v_cupo smallint;
begin
  if v_rol not in ('admin', 'warehouse') then raise exception 'NO_AUTORIZADO: solo Dirección o Almacén reprograman una entrega' using errcode = 'insufficient_privilege'; end if;
  v_motivo := nullif(btrim(left(coalesce(p_motivo, ''), 200)), '');
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'MOTIVO_REQUERIDO: escribe por qué se cambia el horario' using errcode = 'check_violation'; end if;
  select id, status, external_ref, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if o.status in ('cancelled', 'delivered', 'fulfilled') then raise exception 'PEDIDO_CERRADO: el pedido ya está % y no se reprograma', o.status using errcode = 'check_violation'; end if;
  if coalesce(o.shipping_meta -> 'entrega' ->> 'paqueteria', '') <> 'chofer' then raise exception 'HORARIO_NO_APLICA: solo las entregas locales por chofer llevan horario' using errcode = 'check_violation'; end if;
  v_ant := o.shipping_meta -> 'entrega' -> 'horario';
  -- la validación no estricta ignora el cupo del propio pedido: se libera antes de validar
  update public.entrega_horarios set estado = 'liberado', liberado_at = now(), motivo_liberacion = 'Reprogramado: ' || v_motivo where order_id = p_order and estado = 'reservado';
  v_hor := public._entrega_horario_validar(p_fecha, p_inicio, now(), false);
  perform pg_advisory_xact_lock(hashtext('entrega_horario'), hashtext((v_hor ->> 'fecha') || ' ' || (v_hor ->> 'inicio')));
  select horario_cupo into v_cupo from public.entrega_config where id = 1;
  if public._entrega_horario_ocupados((v_hor ->> 'fecha')::date, (v_hor ->> 'inicio')::time) >= v_cupo then
    raise exception 'HORARIO_OCUPADO: ese horario de entrega ya está ocupado; elige otro' using errcode = 'check_violation';
  end if;
  insert into public.entrega_horarios (order_id, fecha, inicio, fin, created_by) values (p_order, (v_hor ->> 'fecha')::date, (v_hor ->> 'inicio')::time, (v_hor ->> 'fin')::time, auth.uid());
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set shipping_meta = jsonb_set(shipping_meta, '{entrega}', (shipping_meta -> 'entrega') || jsonb_build_object('horario', v_hor, 'llega_desde', v_hor -> 'fecha', 'llega_hasta', v_hor -> 'fecha',
                                                                                                                  'reprogramado', jsonb_build_object('anterior', v_ant, 'motivo', v_motivo, 'por', auth.uid(), 'at', now())))
   where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
  perform public.log_audit('Horario de entrega reprogramado', 'orders', coalesce(o.external_ref, p_order::text) || ': ' || coalesce(v_ant ->> 'fecha', '?') || ' ' || coalesce(v_ant ->> 'inicio', '?') || ' → ' || (v_hor ->> 'fecha') || ' ' || (v_hor ->> 'inicio') || ' · ' || v_motivo,
                           case when v_rol = 'admin' then 'Dirección' else 'Almacén' end);
  return jsonb_build_object('order_id', p_order, 'folio', o.external_ref, 'horario', v_hor, 'anterior', v_ant);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9) CONFIGURACIÓN (171, redefinida): acepta los campos horario_*.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.entrega_config_guardar(p jsonb) returns jsonb
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
    -- ENT-H · horarios de entrega local
    horario_franjas       = coalesce(case when jsonb_typeof(p -> 'horario_franjas') = 'array' then p -> 'horario_franjas' end, cfg.horario_franjas),
    horario_intervalo_min = coalesce((p ->> 'horario_intervalo_min')::smallint, cfg.horario_intervalo_min),
    horario_cupo          = coalesce((p ->> 'horario_cupo')::smallint, cfg.horario_cupo),
    horario_margen_min    = coalesce((p ->> 'horario_margen_min')::smallint, cfg.horario_margen_min),
    horario_dias_adelante = coalesce((p ->> 'horario_dias_adelante')::smallint, cfg.horario_dias_adelante),
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  perform public.log_audit('Regla de entrega actualizada', 'entrega_config', left(p::text, 1000), 'Dirección');
  return public.entrega_config_ver();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10) Permisos.
-- ---------------------------------------------------------------------------------------------------
alter function public._entrega_franjas_validas(jsonb) owner to postgres;
alter function public._entrega_horario_slots() owner to postgres;
alter function public._entrega_horario_ocupados(date, time) owner to postgres;
alter function public._entrega_horario_ultimo_dia(date) owner to postgres;
alter function public._entrega_horario_validar(text, text, timestamptz, boolean) owner to postgres;
alter function public._entrega_horarios_liberar_trg() owner to postgres;
alter function public.entrega_horarios_disponibles(timestamptz) owner to postgres;
alter function public.entrega_horarios_agenda(date, date) owner to postgres;
alter function public.entrega_horario_reprogramar(uuid, text, text, text) owner to postgres;
alter function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) owner to postgres;
alter function public._entrega_aplicar(uuid, jsonb) owner to postgres;
alter function public.entrega_config_guardar(jsonb) owner to postgres;
alter table public.entrega_horarios owner to postgres;
revoke all on function public._entrega_franjas_validas(jsonb), public._entrega_horario_slots(), public._entrega_horario_ocupados(date, time), public._entrega_horario_ultimo_dia(date),
  public._entrega_horario_validar(text, text, timestamptz, boolean), public._entrega_horarios_liberar_trg(),
  public._entrega_normalizar(text, numeric, text, jsonb, timestamptz), public._entrega_aplicar(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.entrega_horarios_disponibles(timestamptz), public.entrega_horarios_agenda(date, date), public.entrega_horario_reprogramar(uuid, text, text, text), public.entrega_config_guardar(jsonb) from public, anon;
grant execute on function public.entrega_horarios_disponibles(timestamptz), public.entrega_horarios_agenda(date, date), public.entrega_horario_reprogramar(uuid, text, text, text), public.entrega_config_guardar(jsonb) to authenticated;
comment on function public.entrega_horarios_disponibles(timestamptz) is 'ENT-H · días y horarios de entrega local (disponible / ocupado / pasado) para elegir al vender.';
comment on function public.entrega_horarios_agenda(date, date) is 'ENT-H · agenda de entregas locales por día y horario (Dirección, Almacén/Empaque, Chofer).';
comment on function public.entrega_horario_reprogramar(uuid, text, text, text) is 'ENT-H · Dirección/Almacén mueven una entrega local a otro horario con motivo (bitácora).';

do $post$ begin
  if (select count(*) from public._entrega_horario_slots()) <> 10 then raise exception 'ENT-H: la configuración por defecto debe dar 10 horarios (6 + 4)'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cc_checkout_revisar', 'cc_checkout_confirmar')) <> 2 then raise exception 'ENT-H: firmas duplicadas del checkout'; end if;
  if has_function_privilege('anon', 'public.entrega_horarios_disponibles(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public._entrega_horario_validar(text,text,timestamptz,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._entrega_aplicar(uuid,jsonb)', 'execute')
     or has_table_privilege('authenticated', 'public.entrega_horarios', 'select')
     or not has_function_privilege('authenticated', 'public.entrega_horarios_agenda(date,date)', 'execute') then
    raise exception 'ENT-H: permisos inesperados';
  end if;
  if md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) <> '5769c551e6ca60003ba0fcf9390d80d1'
     or md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> 'bee5aa3614e2b9e0327ebec6a1b38e2e' then
    raise exception 'ENT-H: crear_pedido / crear_pedido_con_receptor cambiaron (no debían)';
  end if;
end $post$;
