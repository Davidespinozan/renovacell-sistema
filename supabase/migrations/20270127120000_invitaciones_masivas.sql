-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- INVITA-1 · INVITACIONES MASIVAS: los clientes actuales (Odoo, sin cuenta) reciben su invitación por correo o por
-- WhatsApp sin que Dirección la mande una por una. Pedido del dueño (27 oct 2026, "DALE").
--   · invitacion_campanas     NUEVA. Una campaña por canal a la vez (correo | whatsapp), con filtro de vendedor, límite
--                             diario y estado (activa, pausada, terminada, cancelada).
--   · invitacion_envios       NUEVA. Foto de la audiencia al crear la campaña: 'pendiente' (sale) u 'omitido' con su
--                             motivo (correo/teléfono repetido o mal escrito, correo que ya tiene cuenta): para revisión.
--   · Envío: cada minuto, SOLO en horario de atención (_cc_horario_estado) y sin pasar el límite diario, la base despierta
--     a la Edge `invitacion` (acción masiva, x-cron-secret). La Edge reclama un lote: la base vuelve a revisar a cada
--     cliente, EMITE su invitación (mismo mecanismo que la individual: solo la huella del secreto) y devuelve el secreto
--     una vez; la Edge manda el correo o la plantilla de WhatsApp y asienta el resultado.
--   · Si Meta rechaza la plantilla (no aprobada, pausada), el envío vuelve a la cola y la campaña se pausa con la nota:
--     nunca se quema la lista.
--   NO cambia: la invitación individual, cómo se acepta, precios, pedidos ni conversaciones.
--   Rollback: supabase/rollback/invitaciones_masivas/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.invitacion_campanas') is not null then raise exception 'INVITA-1: ya aplicada'; end if;
  if to_regclass('public.cliente_invitaciones') is null then raise exception 'INVITA-1: falta la 153 (invitaciones)'; end if;
  if to_regprocedure('public._cc_horario_estado(timestamptz)') is null then raise exception 'INVITA-1: falta el horario de atención (CC-7)'; end if;
end $pre$;

create table public.invitacion_campanas (
  id                uuid primary key default gen_random_uuid(),
  canal             text not null check (canal in ('correo', 'whatsapp')),
  seller_profile_id uuid references public.profiles(id) on delete set null,   -- filtro: solo la cartera de este vendedor
  sin_vendedor      boolean not null default false,                           -- filtro: solo clientes sin vendedor
  limite_diario     integer not null default 150 check (limite_diario between 1 and 1000),
  plantilla_wa      text check (plantilla_wa is null or (plantilla_wa ~ '^[a-z0-9_]+$' and length(plantilla_wa) <= 512)),
  idioma_wa         text not null default 'es_MX' check (idioma_wa ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  estado            text not null default 'activa' check (estado in ('activa', 'pausada', 'terminada', 'cancelada')),
  nota              text check (nota is null or length(nota) <= 300),
  creada_por        uuid references public.profiles(id) on delete set null,
  creada_at         timestamptz not null default now(),
  actualizada_at    timestamptz not null default now(),
  check (not (sin_vendedor and seller_profile_id is not null)),
  check (canal <> 'whatsapp' or plantilla_wa is not null)
);
comment on table public.invitacion_campanas is 'INVITA-1 · envío masivo de invitaciones a clientes existentes. Una campaña viva por canal.';
create unique index uq_invitacion_campana_viva on public.invitacion_campanas (canal) where estado in ('activa', 'pausada');

create table public.invitacion_envios (
  id            bigint generated always as identity primary key,
  campana_id    uuid not null references public.invitacion_campanas(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  destino       text,                       -- correo en minúsculas o celular de 10 dígitos
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'incierto', 'fallido', 'omitido', 'cancelado')),
  motivo        text check (motivo is null or length(motivo) <= 60),
  invitacion_id uuid,                       -- sin FK: la invitación vive en cliente_invitaciones (153) y se baja aparte
  reclamado_at  timestamptz,
  enviado_at    timestamptz,
  proveedor_id  text check (proveedor_id is null or length(proveedor_id) <= 200),
  error         text check (error is null or length(error) <= 300),
  unique (campana_id, customer_id)
);
comment on table public.invitacion_envios is 'INVITA-1 · un renglón por cliente de la campaña. Nunca guarda el secreto del enlace.';
create index ix_invitacion_envios_cola on public.invitacion_envios (campana_id, estado, id);
alter table public.invitacion_campanas enable row level security;   -- sin políticas: solo comandos
alter table public.invitacion_envios enable row level security;
revoke all on table public.invitacion_campanas, public.invitacion_envios from public, anon, authenticated;
grant select, insert, update, delete on table public.invitacion_campanas, public.invitacion_envios to service_role;

-- ── Audiencia: quién recibiría la invitación por este canal, y por qué no a los demás ───────────────
create function public._invm_audiencia(p_canal text, p_seller uuid, p_sin_vendedor boolean)
  returns table (customer_id uuid, nombre text, destino text, motivo text)
  language sql stable security definer set search_path = public as
$$
  with act as (
    select c.id, c.full_name, nullif(lower(btrim(coalesce(c.email, ''))), '') as em,
           nullif(right(regexp_replace(coalesce((select t.numero from public.customer_phones t where t.customer_id = c.id and t.activo
                                                  order by t.es_principal desc, t.created_at limit 1), c.phone, ''), '[^0-9]', '', 'g'), 10), '') as tel,
           c.profile_id
      from public.customers c where c.active
  ), base as (
    select a.* from act a left join public.cc_cartera_clientes k on k.customer_id = a.id
     where a.profile_id is null
       and (p_seller is null or k.seller_profile_id = p_seller)
       and (not coalesce(p_sin_vendedor, false) or k.customer_id is null)
  )
  select b.id, b.full_name,
         case when p_canal = 'correo' then b.em else b.tel end,
         case
           when exists (select 1 from public.cliente_invitaciones i where i.customer_id = b.id and i.usada_at is null and i.revocada_at is null and i.expira_at > now()) then 'invitacion_vigente'
           when p_canal = 'correo' and b.em is null then 'sin_correo'
           when p_canal = 'correo' and b.em !~ '^[^\s@]+@[^\s@]+\.[a-z]{2,}$' then 'correo_invalido'
           when p_canal = 'correo' and (select count(*) from act x where x.em = b.em) > 1 then 'correo_repetido'
           when p_canal = 'correo' and exists (select 1 from public.profiles p where lower(btrim(p.email)) = b.em) then 'correo_con_cuenta'
           when p_canal = 'whatsapp' and (b.tel is null or length(b.tel) <> 10) then 'sin_telefono'
           when p_canal = 'whatsapp' and (select count(*) from act x where x.tel = b.tel) > 1 then 'telefono_repetido'
         end
    from base b
$$;

create function public.invitaciones_masivas_previa(p_canal text, p_seller uuid default null, p_sin_vendedor boolean default false) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v jsonb;
begin
  perform public._cc7_direccion();
  if p_canal is null or p_canal not in ('correo', 'whatsapp') then raise exception 'CANAL_INVALIDO' using errcode = 'check_violation'; end if;
  select jsonb_build_object(
           'canal', p_canal,
           'elegibles', coalesce(sum(n) filter (where motivo is null), 0),
           'omitidos', coalesce(jsonb_object_agg(motivo, n) filter (where motivo is not null), '{}'::jsonb),
           'total', coalesce(sum(n), 0))
    into v
    from (select motivo, count(*) as n from public._invm_audiencia(p_canal, p_seller, p_sin_vendedor) group by motivo) g;
  return v;
end;
$$;

create function public.invitaciones_masivas_crear(p_canal text, p_seller uuid default null, p_sin_vendedor boolean default false,
                                                  p_limite_diario integer default 150, p_plantilla text default null, p_idioma text default 'es_MX') returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_p int; v_o int;
begin
  perform public._cc7_direccion();
  if p_canal is null or p_canal not in ('correo', 'whatsapp') then raise exception 'CANAL_INVALIDO' using errcode = 'check_violation'; end if;
  if p_canal = 'whatsapp' and nullif(btrim(coalesce(p_plantilla, '')), '') is null then raise exception 'FALTA_PLANTILLA: escribe el nombre de la plantilla aprobada por Meta' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.invitacion_campanas where canal = p_canal and estado in ('activa', 'pausada')) then
    raise exception 'CAMPANA_VIVA: ya hay una campaña de este canal en curso; termínala o cancélala primero' using errcode = 'check_violation';
  end if;
  insert into public.invitacion_campanas (canal, seller_profile_id, sin_vendedor, limite_diario, plantilla_wa, idioma_wa, creada_por)
  values (p_canal, p_seller, coalesce(p_sin_vendedor, false), coalesce(p_limite_diario, 150),
          case when p_canal = 'whatsapp' then lower(btrim(p_plantilla)) end, coalesce(nullif(btrim(p_idioma), ''), 'es_MX'), auth.uid())
  returning id into v_id;
  insert into public.invitacion_envios (campana_id, customer_id, destino, estado, motivo)
  select v_id, a.customer_id, a.destino, case when a.motivo is null then 'pendiente' else 'omitido' end, a.motivo
    from public._invm_audiencia(p_canal, p_seller, p_sin_vendedor) a
   where a.motivo is null or a.motivo in ('correo_invalido', 'correo_repetido', 'correo_con_cuenta', 'telefono_repetido');   -- los que conviene revisar
  select count(*) filter (where estado = 'pendiente'), count(*) filter (where estado = 'omitido') into v_p, v_o from public.invitacion_envios where campana_id = v_id;
  if v_p = 0 then raise exception 'SIN_DESTINATARIOS: nadie de este filtro puede recibir la invitación por este canal' using errcode = 'check_violation'; end if;
  return jsonb_build_object('campana_id', v_id, 'pendientes', v_p, 'omitidos', v_o);
end;
$$;

create function public.invitaciones_masivas_cambiar(p_campana uuid, p_accion text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c public.invitacion_campanas;
begin
  perform public._cc7_direccion();
  select * into c from public.invitacion_campanas where id = p_campana for update;
  if not found then raise exception 'CAMPANA_INEXISTENTE' using errcode = 'check_violation'; end if;
  if p_accion = 'pausar' and c.estado = 'activa' then
    update public.invitacion_campanas set estado = 'pausada', actualizada_at = now() where id = c.id;
  elsif p_accion = 'reanudar' and c.estado = 'pausada' then
    update public.invitacion_campanas set estado = 'activa', nota = null, actualizada_at = now() where id = c.id;
  elsif p_accion = 'cancelar' and c.estado in ('activa', 'pausada') then
    update public.invitacion_envios set estado = 'cancelado' where campana_id = c.id and estado = 'pendiente';
    update public.invitacion_campanas set estado = 'cancelada', actualizada_at = now() where id = c.id;
  else
    raise exception 'ACCION_INVALIDA: no se puede % una campaña %', p_accion, c.estado using errcode = 'check_violation';
  end if;
  return jsonb_build_object('campana_id', c.id, 'estado', (select estado from public.invitacion_campanas where id = c.id));
end;
$$;

create function public.invitaciones_masivas_estado() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_zona text := coalesce(public._cc_horario_estado(now()) ->> 'zona', 'America/Mazatlan');
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'campanas', coalesce((select jsonb_agg(x order by x ->> 'creada_at' desc) from (
      select jsonb_build_object(
        'id', c.id, 'canal', c.canal, 'estado', c.estado, 'nota', c.nota, 'limite_diario', c.limite_diario,
        'plantilla_wa', c.plantilla_wa, 'creada_at', c.creada_at, 'sin_vendedor', c.sin_vendedor,
        'vendedor', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.seller_profile_id),
        'pendientes', count(e.id) filter (where e.estado in ('pendiente', 'enviando')),
        'enviados', count(e.id) filter (where e.estado = 'enviado'),
        'inciertos', count(e.id) filter (where e.estado = 'incierto'),
        'fallidos', count(e.id) filter (where e.estado = 'fallido'),
        'omitidos', count(e.id) filter (where e.estado = 'omitido'),
        'cancelados', count(e.id) filter (where e.estado = 'cancelado'),
        'hoy', count(e.id) filter (where e.reclamado_at is not null and (e.reclamado_at at time zone v_zona)::date = (now() at time zone v_zona)::date),
        'cuentas', count(e.id) filter (where e.invitacion_id is not null and exists (select 1 from public.cliente_invitaciones i where i.id = e.invitacion_id and i.usada_at is not null))) as x
        from public.invitacion_campanas c left join public.invitacion_envios e on e.campana_id = c.id
       group by c.id order by c.creada_at desc limit 20) s), '[]'::jsonb));
end;
$$;

create function public.invitaciones_masivas_revisar(p_campana uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(jsonb_build_object('customer_id', e.customer_id, 'nombre', c.full_name, 'destino', e.destino, 'estado', e.estado,
                                                       'motivo', coalesce(e.motivo, e.error)) order by e.estado, e.motivo, c.full_name)
                     from (select * from public.invitacion_envios where campana_id = p_campana and estado in ('omitido', 'fallido', 'incierto') order by id limit 1000) e
                     join public.customers c on c.id = e.customer_id), '[]'::jsonb);
end;
$$;

-- ── Servidor: reclamar un lote (emite las invitaciones) y asentar el resultado ──────────────────────
create function public._invm_reclamar(p_canal text, p_lote integer default 10)
  returns table (envio_id bigint, nombre text, destino text, token text, plantilla_wa text, idioma_wa text)
  language plpgsql security definer set search_path = public as
$$
declare c public.invitacion_campanas; hor jsonb := public._cc_horario_estado(now()); v_zona text; v_hoy int; v_cupo int;
        e record; cu record; v_token text; v_inv uuid;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  -- lo reclamado y nunca asentado (la Edge murió a medio lote) no se reenvía: queda sin confirmar
  update public.invitacion_envios set estado = 'incierto', error = 'sin confirmación del envío'
   where estado = 'enviando' and reclamado_at < now() - interval '10 minutes';
  select * into c from public.invitacion_campanas where canal = p_canal and estado = 'activa' for update;
  if not found or not coalesce((hor ->> 'abierto')::boolean, false) then return; end if;
  v_zona := coalesce(hor ->> 'zona', 'America/Mazatlan');
  select count(*) into v_hoy from public.invitacion_envios
   where campana_id = c.id and reclamado_at is not null and (reclamado_at at time zone v_zona)::date = (now() at time zone v_zona)::date;
  v_cupo := least(greatest(coalesce(p_lote, 10), 1), 50, c.limite_diario - v_hoy);
  if v_cupo <= 0 then return; end if;
  for e in select * from public.invitacion_envios where campana_id = c.id and estado = 'pendiente' order by id limit v_cupo for update skip locked loop
    select id, full_name, profile_id, active into cu from public.customers where id = e.customer_id;
    if not found or not cu.active or cu.profile_id is not null
       or exists (select 1 from public.cliente_invitaciones i where i.customer_id = e.customer_id and i.usada_at is null and i.revocada_at is null and i.expira_at > now()) then
      update public.invitacion_envios set estado = 'omitido',
             motivo = case when cu.profile_id is not null then 'ya_tiene_cuenta' when not coalesce(cu.active, false) then 'dado_de_baja' else 'invitacion_vigente' end
       where id = e.id;
      continue;
    end if;
    -- misma emisión que cliente_invitacion_crear: solo la huella; el secreto sale una vez
    update public.cliente_invitaciones set revocada_at = now() where customer_id = e.customer_id and usada_at is null and revocada_at is null;
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    insert into public.cliente_invitaciones (customer_id, token_hash, creada_por)
    values (e.customer_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), c.creada_por) returning id into v_inv;
    perform public._c360_evento(e.customer_id, 'invitacion_creada', jsonb_build_object('via', 'masiva', 'canal', c.canal, 'campana', c.id), 'servicio');
    update public.invitacion_envios set estado = 'enviando', reclamado_at = now(), invitacion_id = v_inv where id = e.id;
    envio_id := e.id; nombre := cu.full_name; destino := e.destino; token := v_token; plantilla_wa := c.plantilla_wa; idioma_wa := c.idioma_wa;
    return next;
  end loop;
  -- ya no queda nadie en cola: terminada (lo que va en camino se asienta igual; un rechazo del canal la vuelve a pausar)
  if not exists (select 1 from public.invitacion_envios where campana_id = c.id and estado = 'pendiente') then
    update public.invitacion_campanas set estado = 'terminada', actualizada_at = now() where id = c.id;
  end if;
end;
$$;

create function public._invm_resolver(p_envio bigint, p_resultado text, p_proveedor_id text default null, p_error text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare e public.invitacion_envios;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into e from public.invitacion_envios where id = p_envio for update;
  if not found or e.estado <> 'enviando' then return; end if;
  if p_resultado = 'enviado' then
    update public.invitacion_envios set estado = 'enviado', enviado_at = now(), proveedor_id = left(p_proveedor_id, 200), error = null where id = e.id;
  elsif p_resultado = 'incierto' then
    update public.invitacion_envios set estado = 'incierto', error = left(coalesce(p_error, 'sin confirmación del envío'), 300) where id = e.id;
  else
    -- no salió: su invitación se retira (otra campaña o el vendedor pueden volver a invitarlo)
    update public.cliente_invitaciones set revocada_at = now() where id = e.invitacion_id and usada_at is null and revocada_at is null;
    if p_resultado = 'retener' then   -- problema del canal, no del cliente: vuelve a la cola y la campaña se detiene
      update public.invitacion_envios set estado = 'pendiente', reclamado_at = null, invitacion_id = null, error = null where id = e.id;
      update public.invitacion_campanas set estado = 'pausada', nota = left(coalesce(p_error, 'el canal rechazó el envío'), 300), actualizada_at = now()
       where id = e.campana_id and estado in ('activa', 'terminada');
    else
      update public.invitacion_envios set estado = 'fallido', error = left(coalesce(p_error, 'rechazado'), 300) where id = e.id;
    end if;
  end if;
end;
$$;

-- ── Cada minuto: si hay algo que mandar y estamos en horario, despierta a la Edge ───────────────────
create function public._invm_despachar() returns text
  language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text;
begin
  if not exists (select 1 from public.invitacion_campanas c where c.estado = 'activa'
                   and exists (select 1 from public.invitacion_envios e where e.campana_id = c.id and e.estado = 'pendiente')) then
    return 'sin_pendientes';
  end if;
  if not coalesce((public._cc_horario_estado(now()) ->> 'abierto')::boolean, false) then return 'fuera_de_horario'; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 'sin_configurar'; end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/invitacion',
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                        body := '{"action":"masiva"}'::jsonb, timeout_milliseconds := 55000);
  return 'despachado';
end;
$$;

alter function public._invm_audiencia(text, uuid, boolean) owner to postgres;
alter function public.invitaciones_masivas_previa(text, uuid, boolean) owner to postgres;
alter function public.invitaciones_masivas_crear(text, uuid, boolean, integer, text, text) owner to postgres;
alter function public.invitaciones_masivas_cambiar(uuid, text) owner to postgres;
alter function public.invitaciones_masivas_estado() owner to postgres;
alter function public.invitaciones_masivas_revisar(uuid) owner to postgres;
alter function public._invm_reclamar(text, integer) owner to postgres;
alter function public._invm_resolver(bigint, text, text, text) owner to postgres;
alter function public._invm_despachar() owner to postgres;
revoke all on function public._invm_audiencia(text, uuid, boolean), public._invm_reclamar(text, integer), public._invm_resolver(bigint, text, text, text),
                       public._invm_despachar() from public, anon, authenticated;
grant execute on function public._invm_reclamar(text, integer), public._invm_resolver(bigint, text, text, text) to service_role;
revoke all on function public.invitaciones_masivas_previa(text, uuid, boolean), public.invitaciones_masivas_crear(text, uuid, boolean, integer, text, text),
                       public.invitaciones_masivas_cambiar(uuid, text), public.invitaciones_masivas_estado(), public.invitaciones_masivas_revisar(uuid) from public, anon;
grant execute on function public.invitaciones_masivas_previa(text, uuid, boolean), public.invitaciones_masivas_crear(text, uuid, boolean, integer, text, text),
                          public.invitaciones_masivas_cambiar(uuid, text), public.invitaciones_masivas_estado(), public.invitaciones_masivas_revisar(uuid) to authenticated, service_role;

-- Firma exacta de cron.schedule (job_name, schedule, command): idempotente al reaplicar.
select cron.schedule('renovacell-invitaciones', '* * * * *', 'select public._invm_despachar()');

do $post$ begin
  if not exists (select 1 from cron.job where jobname = 'renovacell-invitaciones') then raise exception 'INVITA-1: falta la tarea programada'; end if;
  if has_function_privilege('authenticated', 'public._invm_reclamar(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public._invm_despachar()', 'execute')
     or has_function_privilege('anon', 'public.invitaciones_masivas_crear(text,uuid,boolean,integer,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.invitacion_envios', 'select') then
    raise exception 'INVITA-1: permisos inesperados';
  end if;
end $post$;
