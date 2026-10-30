-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HERRAMIENTAS DEL VENDEDOR · bloque D (30 oct 2026) · LISTAS DE DIFUSIÓN. Los vendedores quieren "crear listas de difusión,
--   elegir la etiqueta y a qué clientes poner adentro… mandar a todos los doctores una difusión (un link, un video, un
--   texto, una imagen) o a un grupo selecto según las características del doctor". Decisión del dueño: por CORREO y por el
--   CHAT DEL PORTAL (sin WhatsApp).
--   · cc_etiquetas / cc_etiqueta_clientes: las listas propias de cada vendedor (nombre que él elige + clientes que él pone).
--   · Audiencia de una difusión: una de sus listas, un filtro (doctores / clínicas / especialidad) o toda su cartera.
--     Vendedor: solo su cartera; jefe de ventas y Dirección: todos.
--   · cc_difusiones / cc_difusion_envios: qué se mandó, a quién y cómo quedó (correo encolado, chat entregado, sin correo,
--     dado de baja). El correo sale por el buzón de siempre (comm_outbox, plantilla 'difusion'); el chat, como tarjeta.
--   · BAJA: cada correo trae "dejar de recibir"; quien se da de baja ya no recibe difusiones por correo (sí sus avisos de
--     pedido). No existía y un envío masivo sin baja termina en spam.
--   · Freno: 5 difusiones por vendedor por día (además del cupo del buzón).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_difusiones') is not null then raise exception 'BLOQUE-D: ya aplicada'; end if;
  if to_regclass('public.especialidades') is null or to_regprocedure('public._jefe_ventas()') is null or to_regprocedure('public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)') is null then
    raise exception 'BLOQUE-D: faltan BLOQUE-B (20270215), COMISIONES-JEFE o CC-2'; end if;
end $pre$;

-- ── Baja de difusiones por correo ──────────────────────────────────────────────────────────────────
alter table public.customers
  add column correo_baja_token uuid not null default gen_random_uuid(),
  add column difusiones_baja_at timestamptz;
create unique index ux_customers_baja_token on public.customers (correo_baja_token);

-- ── Listas (etiquetas) ─────────────────────────────────────────────────────────────────────────────
create table public.cc_etiquetas (
  id                uuid primary key default gen_random_uuid(),
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  nombre            text not null,
  created_at        timestamptz not null default now(),
  constraint ck_cce_nombre check (length(btrim(nombre)) between 2 and 60)
);
create unique index ux_cc_etiquetas_nombre on public.cc_etiquetas (seller_profile_id, lower(btrim(nombre)));
create table public.cc_etiqueta_clientes (
  etiqueta_id uuid not null references public.cc_etiquetas(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (etiqueta_id, customer_id)
);
create table public.cc_difusiones (
  id                uuid primary key default gen_random_uuid(),
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  titulo            text not null,
  texto             text not null,
  enlace            text,
  imagen_url        text,
  audiencia         jsonb not null,
  canales           text[] not null,
  n_destinatarios   integer not null default 0,
  n_correo          integer not null default 0,
  n_chat            integer not null default 0,
  n_sin_correo      integer not null default 0,
  n_baja            integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint ck_dif_titulo check (length(btrim(titulo)) between 3 and 120),
  constraint ck_dif_texto check (length(btrim(texto)) between 1 and 2000),
  constraint ck_dif_enlace check (enlace is null or (enlace ~ '^https://' and length(enlace) <= 500)),
  constraint ck_dif_imagen check (imagen_url is null or (imagen_url ~ '^https://' and length(imagen_url) <= 600))
);
create index idx_dif_seller on public.cc_difusiones (seller_profile_id, created_at desc);
create table public.cc_difusion_envios (
  id          bigint generated always as identity primary key,
  difusion_id uuid not null references public.cc_difusiones(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  canal       text not null check (canal in ('correo', 'chat')),
  estado      text not null check (estado in ('encolado', 'entregado', 'sin_correo', 'dado_de_baja', 'sin_conversacion')),
  detalle     text,
  created_at  timestamptz not null default now(),
  unique (difusion_id, customer_id, canal)
);
alter table public.cc_etiquetas enable row level security;
alter table public.cc_etiqueta_clientes enable row level security;
alter table public.cc_difusiones enable row level security;
alter table public.cc_difusion_envios enable row level security;
revoke all on public.cc_etiquetas, public.cc_etiqueta_clientes, public.cc_difusiones, public.cc_difusion_envios from anon, authenticated;

-- BLOQUE-B (20270215) dejó a `authenticated` con permisos de escritura en especialidades (el RLS ya los negaba: solo hay
-- política de lectura); se dejan solo de lectura, como pide la guarda de permisos.
revoke insert, update, delete, truncate, references, trigger on public.especialidades from authenticated;

alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado',
  'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion', 'cotizacion', 'difusion'));

-- ── Alcance: vendedor = su cartera; jefe de ventas y Dirección = todos ─────────────────────────────
create function public._dif_alcance(out todos boolean, out uid uuid) language plpgsql stable security definer set search_path = public as
$$
begin
  uid := auth.uid();
  if uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  todos := public.auth_role() = 'admin' or public._jefe_ventas();
end;
$$;
create function public._dif_es_mio(p_customer uuid, p_todos boolean, p_uid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.customers c where c.id = p_customer and c.active) and (p_todos or public._cc_vendedor_de_cliente(p_customer) = p_uid) $$;

-- Clientes de una audiencia: {"tipo":"lista","etiqueta_id":…} | {"tipo":"filtro","tipo_cliente":…,"especialidad":…} | {"tipo":"cartera"}
create function public._dif_audiencia(p jsonb) returns setof uuid language plpgsql stable security definer set search_path = public as
$$
declare a record; v_tipo text := p ->> 'tipo';
begin
  select * into a from public._dif_alcance();
  if v_tipo = 'lista' then
    if not exists (select 1 from public.cc_etiquetas e where e.id = (p ->> 'etiqueta_id')::uuid and (e.seller_profile_id = a.uid or a.todos)) then raise exception 'LISTA_INEXISTENTE'; end if;
    return query select ec.customer_id from public.cc_etiqueta_clientes ec where ec.etiqueta_id = (p ->> 'etiqueta_id')::uuid and public._dif_es_mio(ec.customer_id, a.todos, a.uid);
  elsif v_tipo in ('filtro', 'cartera') then
    return query select c.id from public.customers c
      where c.active and (a.todos or public._cc_vendedor_de_cliente(c.id) = a.uid)
        and (v_tipo = 'cartera' or ((p ->> 'tipo_cliente') is null or c.tipo_cliente = p ->> 'tipo_cliente') and ((p ->> 'especialidad') is null or c.especialidad = p ->> 'especialidad'));
  else raise exception 'AUDIENCIA_INVALIDA';
  end if;
end;
$$;

create function public._dif_correo_de(c public.customers) returns text language sql stable security definer set search_path = public as
$$ select nullif(lower(btrim(coalesce(c.email, (select p.email from public.profiles p where p.id = c.profile_id), ''))), '') $$;

-- ── Listas ─────────────────────────────────────────────────────────────────────────────────────────
create function public.mis_listas() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._dif_alcance();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'es_mia', e.seller_profile_id = a.uid,
            'vendedor', case when e.seller_profile_id <> a.uid then public._cc_nombre_personal(e.seller_profile_id) end,
            'clientes', (select count(*) from public.cc_etiqueta_clientes ec where ec.etiqueta_id = e.id)) order by e.nombre)
    from public.cc_etiquetas e where e.seller_profile_id = a.uid or a.todos), '[]'::jsonb);
end;
$$;

create function public.lista_guardar(p_id uuid, p_nombre text) returns jsonb language plpgsql security definer set search_path = public as
$$
declare a record; v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'); v_id uuid;
begin
  select * into a from public._dif_alcance();
  if length(v_nombre) < 2 or length(v_nombre) > 60 then raise exception 'DATO_INVALIDO:nombre'; end if;
  if p_id is null then
    insert into public.cc_etiquetas (seller_profile_id, nombre) values (a.uid, v_nombre) returning id into v_id;
  else
    update public.cc_etiquetas set nombre = v_nombre where id = p_id and seller_profile_id = a.uid returning id into v_id;
    if v_id is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'nombre', v_nombre);
exception when unique_violation then raise exception 'LISTA_REPETIDA: ya tienes una lista con ese nombre';
end;
$$;

create function public.lista_borrar(p_id uuid) returns void language plpgsql security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._dif_alcance();
  delete from public.cc_etiquetas where id = p_id and seller_profile_id = a.uid;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
end;
$$;

-- Agregar o quitar clientes (solo de su alcance) a una lista suya.
create function public.lista_clientes_cambiar(p_id uuid, p_clientes uuid[], p_agregar boolean) returns jsonb language plpgsql security definer set search_path = public as
$$
declare a record; n int;
begin
  select * into a from public._dif_alcance();
  if not exists (select 1 from public.cc_etiquetas where id = p_id and seller_profile_id = a.uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if coalesce(p_agregar, true) then
    insert into public.cc_etiqueta_clientes (etiqueta_id, customer_id)
    select p_id, x from unnest(coalesce(p_clientes, '{}')) x where public._dif_es_mio(x, a.todos, a.uid)
    on conflict do nothing;
  else
    delete from public.cc_etiqueta_clientes where etiqueta_id = p_id and customer_id = any (coalesce(p_clientes, '{}'));
  end if;
  select count(*) into n from public.cc_etiqueta_clientes where etiqueta_id = p_id;
  return jsonb_build_object('clientes', n);
end;
$$;

-- Agregar a una lista suya todos los de un filtro (p. ej. "todos mis dermatólogos").
create function public.lista_agregar_filtro(p_id uuid, p_tipo text, p_especialidad text) returns jsonb language plpgsql security definer set search_path = public as
$$
declare a record; n int;
begin
  select * into a from public._dif_alcance();
  if not exists (select 1 from public.cc_etiquetas where id = p_id and seller_profile_id = a.uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  insert into public.cc_etiqueta_clientes (etiqueta_id, customer_id)
  select p_id, x from public._dif_audiencia(jsonb_build_object('tipo', 'filtro', 'tipo_cliente', p_tipo, 'especialidad', p_especialidad)) x
  on conflict do nothing;
  select count(*) into n from public.cc_etiqueta_clientes where etiqueta_id = p_id;
  return jsonb_build_object('clientes', n);
end;
$$;

-- Buscar clientes de su alcance para ponerlos en una lista (marca los que ya están).
create function public.lista_buscar_clientes(p_id uuid, p_q text, p_solo_lista boolean default false, p_limite integer default 50) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare a record; v_q text := nullif(btrim(translate(lower(coalesce(p_q, '')), 'áéíóúñ', 'aeioun')), '');
begin
  select * into a from public._dif_alcance();
  if p_id is not null and not exists (select 1 from public.cc_etiquetas where id = p_id and (seller_profile_id = a.uid or a.todos)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'nombre') from (
    select jsonb_build_object('customer_id', c.id, 'nombre', c.full_name, 'ciudad', c.city, 'tipo', c.tipo_cliente,
             'especialidad', (select e.nombre from public.especialidades e where e.clave = c.especialidad),
             'con_correo', public._dif_correo_de(c) is not null and c.difusiones_baja_at is null, 'con_cuenta', c.profile_id is not null,
             'en_lista', p_id is not null and exists (select 1 from public.cc_etiqueta_clientes ec where ec.etiqueta_id = p_id and ec.customer_id = c.id)) x
      from public.customers c
     where c.active and (a.todos or public._cc_vendedor_de_cliente(c.id) = a.uid)
       and (v_q is null or translate(lower(c.full_name), 'áéíóúñ', 'aeioun') like '%' || v_q || '%')
       and (not coalesce(p_solo_lista, false) or exists (select 1 from public.cc_etiqueta_clientes ec where ec.etiqueta_id = p_id and ec.customer_id = c.id))
     order by c.full_name limit greatest(1, least(coalesce(p_limite, 50), 200))) t), '[]'::jsonb);
end;
$$;

-- ── Difundir ───────────────────────────────────────────────────────────────────────────────────────
create function public.difusion_previa(p_audiencia jsonb) returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  return (select jsonb_build_object('total', count(*),
            'con_correo', count(*) filter (where public._dif_correo_de(c) is not null and c.difusiones_baja_at is null),
            'dados_de_baja', count(*) filter (where c.difusiones_baja_at is not null),
            'sin_correo', count(*) filter (where public._dif_correo_de(c) is null),
            'con_cuenta', count(*) filter (where c.profile_id is not null))
    from public.customers c where c.id in (select public._dif_audiencia(p_audiencia)));
end;
$$;

create function public._dif_payload(d public.cc_difusiones, c public.customers) returns jsonb language sql stable security definer set search_path = public as
$$ select jsonb_build_object('titulo', d.titulo, 'texto', d.texto, 'enlace', d.enlace, 'imagen_url', d.imagen_url,
     'vendedor', public._cc_nombre_personal(d.seller_profile_id),
     'baja_url', 'https://renovacell.mx/baja?t=' || c.correo_baja_token::text) $$;

create function public.difusion_enviar(p_titulo text, p_texto text, p_enlace text, p_imagen text, p_audiencia jsonb, p_canales text[]) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; d public.cc_difusiones; c public.customers; v_mail text; v_conv uuid; v_trusted text := coalesce(current_setting('app.trusted', true), '');
        v_correo boolean := 'correo' = any (p_canales); v_chat boolean := 'chat' = any (p_canales); v_contenido text;
begin
  select * into a from public._dif_alcance();
  if not (v_correo or v_chat) then raise exception 'DATO_INVALIDO:canales'; end if;
  if (select count(*) from public.cc_difusiones where seller_profile_id = a.uid and created_at >= (public.hoy_local()::timestamp at time zone 'America/Mazatlan')) >= 5 then
    raise exception 'LIMITE_DIARIO: ya mandaste 5 difusiones hoy'; end if;
  insert into public.cc_difusiones (seller_profile_id, titulo, texto, enlace, imagen_url, audiencia, canales)
  values (a.uid, btrim(p_titulo), btrim(p_texto), nullif(btrim(coalesce(p_enlace, '')), ''), nullif(btrim(coalesce(p_imagen, '')), ''), p_audiencia, p_canales)
  returning * into d;
  v_contenido := '[difusion:' || d.id || ']' || chr(10) || d.titulo || chr(10) || d.texto
    || case when d.enlace is not null then chr(10) || '[enlace] ' || d.enlace else '' end
    || case when d.imagen_url is not null then chr(10) || '[imagen] ' || d.imagen_url else '' end;
  perform set_config('app.trusted', 'on', true);
  for c in select cu.* from public.customers cu where cu.id in (select public._dif_audiencia(p_audiencia)) loop
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
  end loop;
  perform set_config('app.trusted', v_trusted, true);
  if d.n_destinatarios = 0 then raise exception 'AUDIENCIA_VACIA: no hay clientes en esa audiencia'; end if;
  update public.cc_difusiones set n_destinatarios = d.n_destinatarios, n_correo = d.n_correo, n_chat = d.n_chat, n_sin_correo = d.n_sin_correo, n_baja = d.n_baja where id = d.id;
  return jsonb_build_object('id', d.id, 'destinatarios', d.n_destinatarios, 'correo', d.n_correo, 'chat', d.n_chat, 'sin_correo', d.n_sin_correo, 'dados_de_baja', d.n_baja);
end;
$$;

-- Prueba al correo de quien la manda (para ver cómo llega antes de mandarla a todos).
create function public.difusion_prueba(p_titulo text, p_texto text, p_enlace text, p_imagen text) returns jsonb language plpgsql security definer set search_path = public as
$$
declare a record; v_mail text; v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  select * into a from public._dif_alcance();
  select nullif(lower(btrim(email)), '') into v_mail from public.profiles where id = a.uid;
  if v_mail is null then raise exception 'SIN_CORREO: tu cuenta no tiene correo'; end if;
  if (select count(*) from public.comm_outbox where event_key like 'difusion-prueba:' || a.uid || ':%' and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'PRUEBAS_EXCEDIDAS: espera unos minutos'; end if;
  if length(btrim(coalesce(p_titulo, ''))) < 3 or length(btrim(coalesce(p_texto, ''))) < 1 then raise exception 'DATO_INVALIDO:texto'; end if;
  perform set_config('app.trusted', 'on', true);
  insert into public.comm_outbox (event_key, plantilla, profile_id, to_address, to_name, payload, status)
  values ('difusion-prueba:' || a.uid || ':' || extract(epoch from clock_timestamp())::text, 'difusion', a.uid, v_mail, public._cc_nombre_personal(a.uid),
          jsonb_build_object('titulo', btrim(p_titulo), 'texto', btrim(p_texto), 'enlace', nullif(btrim(coalesce(p_enlace, '')), ''), 'imagen_url', nullif(btrim(coalesce(p_imagen, '')), ''),
                             'vendedor', public._cc_nombre_personal(a.uid), 'prueba', true), 'pendiente');
  perform set_config('app.trusted', v_trusted, true);
  return jsonb_build_object('para', regexp_replace(v_mail, '^(.).*(@.*)$', '\1•••\2'));
end;
$$;

create function public.mis_difusiones() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._dif_alcance();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'texto', d.texto, 'enlace', d.enlace, 'imagen_url', d.imagen_url, 'audiencia', d.audiencia,
            'canales', d.canales, 'destinatarios', d.n_destinatarios, 'correo', d.n_correo, 'chat', d.n_chat, 'sin_correo', d.n_sin_correo, 'dados_de_baja', d.n_baja,
            'creada', d.created_at, 'es_mia', d.seller_profile_id = a.uid, 'vendedor', public._cc_nombre_personal(d.seller_profile_id),
            'lista', (select e.nombre from public.cc_etiquetas e where e.id = (d.audiencia ->> 'etiqueta_id')::uuid)) order by d.created_at desc)
    from (select * from public.cc_difusiones where seller_profile_id = a.uid or a.todos order by created_at desc limit 50) d), '[]'::jsonb);
end;
$$;

-- BAJA · pública (con el token del correo): ya no recibe difusiones por correo. Idempotente; no revela nada más.
create function public.correo_baja(p_token uuid) returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_nombre text;
begin
  update public.customers set difusiones_baja_at = coalesce(difusiones_baja_at, now()) where correo_baja_token = p_token returning full_name into v_nombre;
  return jsonb_build_object('ok', v_nombre is not null);
end;
$$;

revoke all on function public._dif_alcance(), public._dif_es_mio(uuid, boolean, uuid), public._dif_audiencia(jsonb), public._dif_correo_de(public.customers),
  public._dif_payload(public.cc_difusiones, public.customers) from public, anon, authenticated;
revoke all on function public.mis_listas(), public.lista_guardar(uuid, text), public.lista_borrar(uuid), public.lista_clientes_cambiar(uuid, uuid[], boolean),
  public.lista_agregar_filtro(uuid, text, text), public.lista_buscar_clientes(uuid, text, boolean, integer), public.difusion_previa(jsonb),
  public.difusion_enviar(text, text, text, text, jsonb, text[]), public.difusion_prueba(text, text, text, text), public.mis_difusiones() from public, anon;
grant execute on function public.mis_listas(), public.lista_guardar(uuid, text), public.lista_borrar(uuid), public.lista_clientes_cambiar(uuid, uuid[], boolean),
  public.lista_agregar_filtro(uuid, text, text), public.lista_buscar_clientes(uuid, text, boolean, integer), public.difusion_previa(jsonb),
  public.difusion_enviar(text, text, text, text, jsonb, text[]), public.difusion_prueba(text, text, text, text), public.mis_difusiones() to authenticated;
revoke all on function public.correo_baja(uuid) from public;
grant execute on function public.correo_baja(uuid) to anon, authenticated, service_role;

do $post$ begin
  if to_regprocedure('public.difusion_enviar(text,text,text,text,jsonb,text[])') is null or to_regprocedure('public.correo_baja(uuid)') is null then
    raise exception 'BLOQUE-D: no quedó aplicada'; end if;
end $post$;
