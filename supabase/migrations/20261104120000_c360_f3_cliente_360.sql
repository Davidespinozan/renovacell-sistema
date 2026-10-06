-- ============================================================================
-- C360-F3 · CUSTOMER 360 CANÓNICO (migración 121)
--
-- Customer 360 es una SUPERFICIE administrativa: agrega dominios canónicos, no crea un maestro nuevo.
--   identidad comercial  → customers (customers.id)            portal → profiles (+ meta, verificación)
--   teléfonos            → customer_phones (0..N, uno principal; customers.phone = espejo del principal)
--   domicilios           → doctor_locations (0..N; + tipo, municipio; alias libre en `name`)
--   perfiles fiscales    → customer_fiscal_profiles (0..N, uno predeterminado; customers.meta.fiscal
--                          queda como ESPEJO de compatibilidad del predeterminado, escrito solo aquí)
--   notas                → customer_notes (append-only)       actividad → customer_events (append-only)
--   vendedor             → cc_cartera (CC-7; aquí solo se LEE)  atribución → cc_visitors / prospects
-- Autoridad (servidor): Dirección amplia; vendedor solo su cartera y solo contacto/teléfonos/domicilios/
-- notas; doctor lo propio (contacto, teléfonos, domicilios, fiscal); facturación solo fiscal; anon nada.
-- Se cierran escrituras directas a doctor_locations y la autoridad amplia de pos/billing en las RPC
-- heredadas. Checkout canónico: el doctor elige su perfil fiscal; se congela como receptor del pedido.
-- Rollback: supabase/rollback/c360_f3/99_down.sql
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public._cc_chk_customer(uuid)') is null then raise exception 'C360-F3: falta C360-0 (120)'; end if;
  if to_regclass('public.cc_cartera') is null then raise exception 'C360-F3: falta CC-7 (119)'; end if;
end $pre$;

-- ── 1) Tablas canónicas ──────────────────────────────────────────────────────
create table public.customer_phones (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  numero text not null constraint ck_cph_numero check (length(btrim(numero)) between 7 and 30),
  numero_norm text not null constraint ck_cph_norm check (numero_norm ~ '^[0-9]{7,15}$'),
  etiqueta text not null default 'otro' constraint ck_cph_etiqueta check (etiqueta in ('celular', 'whatsapp', 'consultorio', 'recepcion', 'otro')),
  es_principal boolean not null default false,
  activo boolean not null default true,
  origen text not null default 'manual' constraint ck_cph_origen check (origen in ('manual', 'migracion', 'legado')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  constraint ck_cph_principal_activo check (not es_principal or activo)
);
create unique index uq_customer_phones_principal on public.customer_phones (customer_id) where es_principal and activo;
create unique index uq_customer_phones_numero on public.customer_phones (customer_id, numero_norm) where activo;
create index idx_customer_phones_customer on public.customer_phones (customer_id);

create table public.customer_fiscal_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  alias text not null constraint ck_cfp_alias check (length(btrim(alias)) between 1 and 80),
  rfc text not null, razon_social text not null, regimen text not null, cp text not null, uso_cfdi text not null, email_facturacion text not null,
  es_predeterminado boolean not null default false,
  activo boolean not null default true,
  origen text not null default 'manual' constraint ck_cfp_origen check (origen in ('manual', 'migracion', 'legado')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  constraint ck_cfp_valido check (public._fiscal_error(jsonb_build_object('rfc', rfc, 'razon_social', razon_social, 'regimen', regimen, 'cp', cp, 'uso_cfdi', uso_cfdi, 'email_facturacion', email_facturacion)) is null),
  constraint ck_cfp_predeterminado_activo check (not es_predeterminado or activo)
);
create unique index uq_customer_fiscal_default on public.customer_fiscal_profiles (customer_id) where es_predeterminado and activo;
create index idx_customer_fiscal_customer on public.customer_fiscal_profiles (customer_id);

create table public.customer_notes (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  texto text not null constraint ck_cn_texto check (length(btrim(texto)) between 1 and 2000),
  autor_profile_id uuid references public.profiles(id), autor_rol text,
  created_at timestamptz not null default now()
);
create index idx_customer_notes_customer on public.customer_notes (customer_id, created_at desc);
create trigger trg_cn_append_only before update or delete on public.customer_notes for each row execute function public._cc_append_only();

create table public.customer_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  tipo text not null constraint ck_ce_tipo check (tipo in ('contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado',
    'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta',
    'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion')),
  detalle jsonb constraint ck_ce_detalle check (detalle is null or length(detalle::text) <= 1000),   -- ids y NOMBRES de campos, nunca valores personales
  actor_profile_id uuid references public.profiles(id), actor_rol text,
  created_at timestamptz not null default now()
);
create index idx_customer_events_customer on public.customer_events (customer_id, created_at desc);
create trigger trg_ce_append_only before update or delete on public.customer_events for each row execute function public._cc_append_only();

alter table public.customer_phones enable row level security;
alter table public.customer_fiscal_profiles enable row level security;
alter table public.customer_notes enable row level security;
alter table public.customer_events enable row level security;
revoke all on public.customer_phones, public.customer_fiscal_profiles, public.customer_notes, public.customer_events from public, anon, authenticated;

-- ── 2) Domicilios: tipo + municipio (el alias sigue en `name`) ──────────────────
alter table public.doctor_locations
  add column tipo text constraint ck_dl_tipo check (tipo is null or tipo in ('CONSULTORIO', 'CLINICA_HOSPITAL', 'CASA', 'OFICINA', 'ALMACEN', 'OTRO')),
  add column municipio text constraint ck_dl_municipio check (municipio is null or length(municipio) <= 120);
-- Las escrituras pasan a comandos con autoridad (antes: INSERT/UPDATE/DELETE directos bajo RLS).
revoke insert, update, delete on public.doctor_locations from authenticated, anon;

-- ── 3) Autoridad ─────────────────────────────────────────────────────────────
-- Quién es el que llama respecto de ESTE cliente. El vendedor solo con cartera vigente (CC-7).
create or replace function public._c360_actor(p_customer uuid) returns text
  language plpgsql stable security definer set search_path = public as
$$
declare v_rol text := public.auth_role(); v_profile uuid;
begin
  if public._cc_es_service() then return 'servicio'; end if;
  if v_rol = 'admin' then return 'direccion'; end if;
  select profile_id into v_profile from public.customers where id = p_customer;
  if not found then return null; end if;
  if v_rol = 'billing' then return 'facturacion'; end if;
  if v_rol = 'pos' and v_profile is not null
     and exists (select 1 from public.cc_cartera k where k.profile_id = v_profile and k.seller_profile_id = auth.uid()) then return 'vendedor'; end if;
  if v_rol = 'doctor' and v_profile is not null and v_profile = auth.uid() then return 'dueno'; end if;
  return null;
end;
$$;

-- Cliente objetivo: explícito, o el propio del doctor cuando p_customer es null.
create or replace function public._c360_cliente(p_customer uuid) returns uuid
  language sql stable set search_path = public as
$$ select coalesce(p_customer, (select c.id from public.customers c where c.profile_id = auth.uid() and public.auth_role() = 'doctor')) $$;

create or replace function public._c360_exige(p_customer uuid, p_permitidos text[]) returns text
  language plpgsql stable set search_path = public as
$$
declare a text := public._c360_actor(p_customer);
begin
  if a is null or not (a = any (p_permitidos) or a = 'servicio') then
    raise exception 'NO_AUTORIZADO: no puedes modificar este dominio de este cliente' using errcode = 'insufficient_privilege';
  end if;
  return a;
end;
$$;

create or replace function public._c360_evento(p_customer uuid, p_tipo text, p_detalle jsonb, p_actor text) returns void
  language sql set search_path = public as
$$ insert into public.customer_events (customer_id, tipo, detalle, actor_profile_id, actor_rol) values (p_customer, p_tipo, p_detalle, auth.uid(), p_actor) $$;

-- ── 4) Teléfonos ─────────────────────────────────────────────────────────────
-- Normalización de identidad del número (igual que F1 · _norm_phone): últimos 10 dígitos. "+52 669…" = "669…".
create or replace function public._c360_tel_norm(p text) returns text
  language sql immutable as $$ select right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10) $$;

-- Espejo: customers.phone = número del principal activo (consultable y compatible con lectores existentes).
create or replace function public._c360_espejo_tel(p_customer uuid) returns void
  language sql set search_path = public as
$$
  update public.customers c set phone = (select p.numero from public.customer_phones p where p.customer_id = c.id and p.es_principal and p.activo), updated_at = now()
   where c.id = p_customer
     and c.phone is distinct from (select p.numero from public.customer_phones p where p.customer_id = c.id and p.es_principal and p.activo)
$$;

-- Escrituras heredadas a customers.phone (alta/aprobación, upsert_customer_contact, importación) se reflejan
-- como teléfono principal sin duplicar: idempotente por número normalizado.
create or replace function public._c360_tel_desde_customer() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare n text := public._c360_tel_norm(new.phone); ex record;
begin
  if coalesce(current_setting('app.c360_espejo', true), '') = 'on' then return new; end if;   -- lo escribió un comando C360
  if nullif(btrim(coalesce(new.phone, '')), '') is null or n !~ '^[0-9]{7,15}$' then return new; end if;
  if tg_op = 'UPDATE' and public._c360_tel_norm(old.phone) = n then return new; end if;
  select * into ex from public.customer_phones where customer_id = new.id and numero_norm = n and activo;
  if found then
    if not ex.es_principal then
      update public.customer_phones set es_principal = false, updated_at = now() where customer_id = new.id and es_principal and activo;
      update public.customer_phones set es_principal = true, updated_at = now() where id = ex.id;
    end if;
    return new;
  end if;
  update public.customer_phones set es_principal = false, updated_at = now() where customer_id = new.id and es_principal and activo;
  insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, es_principal, origen) values (new.id, btrim(new.phone), n, 'otro', true, 'legado');
  return new;
end;
$$;
create trigger trg_customers_phone_c360 after insert or update of phone on public.customers for each row execute function public._c360_tel_desde_customer();

create or replace function public.cliente_telefono_guardar(p_customer uuid, p_telefono uuid, p_numero text, p_etiqueta text, p_principal boolean default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text; n text := public._c360_tel_norm(p_numero); t record; v_id uuid; v_primero boolean;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  if regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g') !~ '^[0-9]{10,15}$' then raise exception 'TELEFONO_INVALIDO: escribe de 10 a 15 dígitos' using errcode = 'check_violation'; end if;
  if coalesce(p_etiqueta, '') not in ('celular', 'whatsapp', 'consultorio', 'recepcion', 'otro') then raise exception 'ETIQUETA_INVALIDA' using errcode = 'check_violation'; end if;
  perform 1 from public.customers where id = v_c for update;   -- serializa los cambios de contacto del cliente
  if exists (select 1 from public.customer_phones where customer_id = v_c and numero_norm = n and activo and id is distinct from p_telefono) then
    raise exception 'TELEFONO_DUPLICADO: ese número ya está registrado' using errcode = 'unique_violation';
  end if;
  v_primero := not exists (select 1 from public.customer_phones where customer_id = v_c and activo and id is distinct from p_telefono);
  if p_telefono is null then
    insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, created_by, updated_by) values (v_c, btrim(p_numero), n, p_etiqueta, auth.uid(), auth.uid()) returning id into v_id;
    perform public._c360_evento(v_c, 'telefono_agregado', jsonb_build_object('telefono_id', v_id, 'etiqueta', p_etiqueta), a);
  else
    select * into t from public.customer_phones where id = p_telefono and customer_id = v_c and activo for update;
    if not found then raise exception 'TELEFONO_INEXISTENTE' using errcode = 'check_violation'; end if;
    update public.customer_phones set numero = btrim(p_numero), numero_norm = n, etiqueta = p_etiqueta, updated_at = now(), updated_by = auth.uid() where id = p_telefono;
    v_id := p_telefono;
    perform public._c360_evento(v_c, 'telefono_actualizado', jsonb_build_object('telefono_id', v_id, 'etiqueta', p_etiqueta), a);
  end if;
  if coalesce(p_principal, false) or v_primero then
    update public.customer_phones set es_principal = false, updated_at = now() where customer_id = v_c and es_principal and activo and id <> v_id;
    update public.customer_phones set es_principal = true where id = v_id;
  end if;
  perform set_config('app.c360_espejo', 'on', true); perform public._c360_espejo_tel(v_c); perform set_config('app.c360_espejo', 'off', true);
  return jsonb_build_object('id', v_id, 'customer_id', v_c);
end;
$$;

create or replace function public.cliente_telefono_principal(p_telefono uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare t record; a text;
begin
  select * into t from public.customer_phones where id = p_telefono;
  if not found then raise exception 'TELEFONO_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(t.customer_id, array['direccion', 'vendedor', 'dueno']);
  perform 1 from public.customers where id = t.customer_id for update;
  select * into t from public.customer_phones where id = p_telefono;
  if not t.activo then raise exception 'TELEFONO_ARCHIVADO: un teléfono archivado no puede ser principal' using errcode = 'check_violation'; end if;
  if t.es_principal then return jsonb_build_object('id', t.id, 'idempotente', true); end if;
  update public.customer_phones set es_principal = false, updated_at = now() where customer_id = t.customer_id and es_principal and activo;
  update public.customer_phones set es_principal = true, updated_at = now(), updated_by = auth.uid() where id = t.id;
  perform set_config('app.c360_espejo', 'on', true); perform public._c360_espejo_tel(t.customer_id); perform set_config('app.c360_espejo', 'off', true);
  perform public._c360_evento(t.customer_id, 'telefono_principal', jsonb_build_object('telefono_id', t.id), a);
  return jsonb_build_object('id', t.id, 'idempotente', false);
end;
$$;

-- Archivar el principal promueve, de forma determinista, el activo más antiguo.
create or replace function public.cliente_telefono_archivar(p_telefono uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare t record; a text; v_nuevo uuid;
begin
  select * into t from public.customer_phones where id = p_telefono;
  if not found then raise exception 'TELEFONO_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(t.customer_id, array['direccion', 'vendedor', 'dueno']);
  perform 1 from public.customers where id = t.customer_id for update;
  select * into t from public.customer_phones where id = p_telefono;
  if not t.activo then return jsonb_build_object('id', t.id, 'idempotente', true); end if;
  update public.customer_phones set activo = false, es_principal = false, updated_at = now(), updated_by = auth.uid() where id = t.id;
  if t.es_principal then
    select id into v_nuevo from public.customer_phones where customer_id = t.customer_id and activo order by created_at, id limit 1;
    if v_nuevo is not null then update public.customer_phones set es_principal = true, updated_at = now() where id = v_nuevo; end if;
  end if;
  perform set_config('app.c360_espejo', 'on', true); perform public._c360_espejo_tel(t.customer_id); perform set_config('app.c360_espejo', 'off', true);
  perform public._c360_evento(t.customer_id, 'telefono_archivado', jsonb_build_object('telefono_id', t.id, 'nuevo_principal', v_nuevo), a);
  return jsonb_build_object('id', t.id, 'nuevo_principal', v_nuevo, 'idempotente', false);
end;
$$;

-- ── 5) Contacto y notas ──────────────────────────────────────────────────────
-- Dirección: nombre, correo, ciudad, país. Vendedor (su cartera): correo, ciudad, país. Doctor: ciudad, país.
create or replace function public.cliente_contacto_guardar(p_customer uuid, p_patch jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text; v_campos text[] := '{}'; k text; v text;
  permitidos text[];
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  permitidos := case a when 'direccion' then array['full_name', 'email', 'city', 'country'] when 'servicio' then array['full_name', 'email', 'city', 'country']
                       when 'vendedor' then array['email', 'city', 'country'] else array['city', 'country'] end;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'CONTACTO_INVALIDO' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (permitidos)) then raise exception 'CAMPO_NO_PERMITIDO: %', k using errcode = 'insufficient_privilege'; end if;
    v := nullif(btrim(coalesce(p_patch ->> k, '')), '');
    if v is not null and length(v) > 160 then raise exception 'CONTACTO_INVALIDO: % demasiado largo', k using errcode = 'check_violation'; end if;
    if k = 'email' and v is not null and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CORREO_INVALIDO' using errcode = 'check_violation'; end if;
    if k = 'full_name' and v is null then raise exception 'NOMBRE_REQUERIDO' using errcode = 'check_violation'; end if;
    v_campos := v_campos || k;
  end loop;
  update public.customers set
    full_name = case when 'full_name' = any (v_campos) then btrim(p_patch ->> 'full_name') else full_name end,
    email     = case when 'email' = any (v_campos) then nullif(lower(btrim(p_patch ->> 'email')), '') else email end,
    city      = case when 'city' = any (v_campos) then nullif(btrim(p_patch ->> 'city'), '') else city end,
    country   = case when 'country' = any (v_campos) then nullif(btrim(p_patch ->> 'country'), '') else country end,
    updated_at = now()
  where id = v_c;
  perform public._c360_evento(v_c, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(v_campos)), a);
  return jsonb_build_object('customer_id', v_c, 'campos', to_jsonb(v_campos));
end;
$$;

create or replace function public.cliente_nota_agregar(p_customer uuid, p_texto text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a text; v_id bigint;
begin
  a := public._c360_exige(p_customer, array['direccion', 'vendedor']);
  if p_texto is null or length(btrim(p_texto)) = 0 or length(p_texto) > 2000 then raise exception 'NOTA_INVALIDA' using errcode = 'check_violation'; end if;
  insert into public.customer_notes (customer_id, texto, autor_profile_id, autor_rol) values (p_customer, btrim(p_texto), auth.uid(), a) returning id into v_id;
  perform public._c360_evento(p_customer, 'nota_agregada', jsonb_build_object('nota_id', v_id), a);
  return jsonb_build_object('id', v_id);
end;
$$;

-- ── 6) Domicilios ────────────────────────────────────────────────────────────
-- Ubicación → cliente dueño (por customer_id o por el doctor del perfil).
create or replace function public._c360_cliente_de_ubicacion(p_ubicacion uuid) returns uuid
  language sql stable set search_path = public as
$$
  select coalesce(l.customer_id, (select c.id from public.customers c where c.profile_id = l.doctor_id))
    from public.doctor_locations l where l.id = p_ubicacion
$$;

-- Deja UN predeterminado activo por cliente (ancla cliente y doctor) — el índice parcial lo garantiza.
create or replace function public._c360_ubic_predeterminar(p_customer uuid, p_ubicacion uuid) returns void
  language plpgsql set search_path = public as
$$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.customers where id = p_customer;
  update public.doctor_locations set is_default = false, updated_at = now()
   where is_default and active and id <> p_ubicacion and (customer_id = p_customer or (v_profile is not null and doctor_id = v_profile));
  update public.doctor_locations set is_default = true, updated_at = now() where id = p_ubicacion;
end;
$$;

create or replace function public._c360_ubic_validar(d jsonb) returns jsonb
  language plpgsql immutable as
$$
declare t text := upper(btrim(coalesce(d ->> 'tipo', ''))); o jsonb;
  f text; lim int;
begin
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'DOMICILIO_INVALIDO' using errcode = 'check_violation'; end if;
  if t not in ('CONSULTORIO', 'CLINICA_HOSPITAL', 'CASA', 'OFICINA', 'ALMACEN', 'OTRO') then raise exception 'DOMICILIO_INVALIDO: tipo' using errcode = 'check_violation'; end if;
  o := jsonb_build_object('tipo', t);
  foreach f in array array['name', 'line1', 'exterior_number', 'interior_number', 'neighborhood', 'postal_code', 'municipio', 'city', 'state', 'country', 'reference_notes', 'contact_name', 'contact_phone'] loop
    lim := case f when 'reference_notes' then 500 when 'line1' then 200 when 'exterior_number' then 20 when 'interior_number' then 20 when 'postal_code' then 5 when 'contact_phone' then 30 when 'state' then 80 else 120 end;
    if length(btrim(coalesce(d ->> f, ''))) > lim then raise exception 'DOMICILIO_INVALIDO: % demasiado largo', f using errcode = 'check_violation'; end if;
    o := o || jsonb_build_object(f, nullif(btrim(coalesce(d ->> f, '')), ''));
  end loop;
  if o ->> 'name' is null then raise exception 'DOMICILIO_INVALIDO: alias requerido' using errcode = 'check_violation'; end if;
  if coalesce(length(o ->> 'line1'), 0) < 3 then raise exception 'DOMICILIO_INVALIDO: calle requerida' using errcode = 'check_violation'; end if;
  if coalesce(o ->> 'postal_code', '') !~ '^[0-9]{5}$' then raise exception 'DOMICILIO_INVALIDO: el CP debe tener 5 dígitos' using errcode = 'check_violation'; end if;
  if o ->> 'city' is null or o ->> 'state' is null then raise exception 'DOMICILIO_INVALIDO: ciudad y estado requeridos' using errcode = 'check_violation'; end if;
  return o;
end;
$$;

create or replace function public.cliente_ubicacion_guardar(p_customer uuid, p_ubicacion uuid, p_datos jsonb, p_predeterminada boolean default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := coalesce(public._c360_cliente(p_customer), public._c360_cliente_de_ubicacion(p_ubicacion)); a text; o jsonb; v_id uuid; v_profile uuid; v_primera boolean; l record;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  o := public._c360_ubic_validar(p_datos);
  select profile_id into v_profile from public.customers where id = v_c for update;
  if p_ubicacion is null then
    v_primera := not exists (select 1 from public.doctor_locations where active and (customer_id = v_c or (v_profile is not null and doctor_id = v_profile)));
    insert into public.doctor_locations (doctor_id, customer_id, name, tipo, line1, exterior_number, interior_number, neighborhood, postal_code, municipio, city, state, country, reference_notes, contact_name, contact_phone, is_default, active)
    values (v_profile, v_c, o ->> 'name', o ->> 'tipo', o ->> 'line1', o ->> 'exterior_number', o ->> 'interior_number', o ->> 'neighborhood', o ->> 'postal_code', o ->> 'municipio', o ->> 'city', o ->> 'state',
            coalesce(o ->> 'country', 'México'), o ->> 'reference_notes', o ->> 'contact_name', o ->> 'contact_phone', false, true)
    returning id into v_id;
    perform public._c360_evento(v_c, 'domicilio_agregado', jsonb_build_object('domicilio_id', v_id, 'tipo', o ->> 'tipo'), a);
  else
    select * into l from public.doctor_locations where id = p_ubicacion for update;
    if not found or public._c360_cliente_de_ubicacion(p_ubicacion) is distinct from v_c then raise exception 'DOMICILIO_INEXISTENTE' using errcode = 'check_violation'; end if;
    if not l.active then raise exception 'DOMICILIO_ARCHIVADO: un domicilio archivado no se edita' using errcode = 'check_violation'; end if;
    update public.doctor_locations set name = o ->> 'name', tipo = o ->> 'tipo', line1 = o ->> 'line1', exterior_number = o ->> 'exterior_number', interior_number = o ->> 'interior_number',
           neighborhood = o ->> 'neighborhood', postal_code = o ->> 'postal_code', municipio = o ->> 'municipio', city = o ->> 'city', state = o ->> 'state', country = coalesce(o ->> 'country', country),
           reference_notes = o ->> 'reference_notes', contact_name = o ->> 'contact_name', contact_phone = o ->> 'contact_phone', customer_id = coalesce(customer_id, v_c), updated_at = now()
     where id = p_ubicacion;
    v_id := p_ubicacion; v_primera := false;
    perform public._c360_evento(v_c, 'domicilio_actualizado', jsonb_build_object('domicilio_id', v_id, 'tipo', o ->> 'tipo'), a);
  end if;
  if coalesce(p_predeterminada, false) or v_primera then perform public._c360_ubic_predeterminar(v_c, v_id); end if;
  return jsonb_build_object('id', v_id, 'customer_id', v_c);
end;
$$;

create or replace function public.cliente_ubicacion_predeterminar(p_ubicacion uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente_de_ubicacion(p_ubicacion); a text; l record;
begin
  if v_c is null then raise exception 'DOMICILIO_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  perform 1 from public.customers where id = v_c for update;
  select * into l from public.doctor_locations where id = p_ubicacion;
  if not l.active then raise exception 'UBICACION_INACTIVA: un domicilio archivado no puede ser predeterminado' using errcode = 'check_violation'; end if;
  if l.is_default then return jsonb_build_object('id', l.id, 'idempotente', true); end if;
  perform public._c360_ubic_predeterminar(v_c, p_ubicacion);
  perform public._c360_evento(v_c, 'domicilio_predeterminado', jsonb_build_object('domicilio_id', p_ubicacion), a);
  return jsonb_build_object('id', p_ubicacion, 'idempotente', false);
end;
$$;

-- Archivar = desactivar (nunca borrar: los pedidos conservan su snapshot). El predeterminado se pasa
-- al activo más antiguo (determinista).
create or replace function public.cliente_ubicacion_archivar(p_ubicacion uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente_de_ubicacion(p_ubicacion); a text; l record; v_profile uuid; v_nuevo uuid;
begin
  if v_c is null then raise exception 'DOMICILIO_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor', 'dueno']);
  select profile_id into v_profile from public.customers where id = v_c for update;
  select * into l from public.doctor_locations where id = p_ubicacion;
  if not l.active then return jsonb_build_object('id', l.id, 'idempotente', true); end if;
  update public.doctor_locations set active = false, is_default = false, updated_at = now() where id = p_ubicacion;
  if l.is_default then
    select id into v_nuevo from public.doctor_locations where active and (customer_id = v_c or (v_profile is not null and doctor_id = v_profile)) order by created_at, id limit 1;
    if v_nuevo is not null then perform public._c360_ubic_predeterminar(v_c, v_nuevo); end if;
  end if;
  perform public._c360_evento(v_c, 'domicilio_archivado', jsonb_build_object('domicilio_id', p_ubicacion, 'nuevo_predeterminado', v_nuevo), a);
  return jsonb_build_object('id', p_ubicacion, 'nuevo_predeterminado', v_nuevo, 'idempotente', false);
end;
$$;

-- Adopción EXPLÍCITA del domicilio del alta (profiles.meta.shipping) como domicilio canónico. Nunca
-- automática ni con datos incompletos: si falta calle/CP/ciudad/estado se reporta y no se fabrica.
create or replace function public.cliente_ubicacion_adoptar_alta(p_customer uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text; s jsonb; v_profile uuid; r jsonb;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'dueno']);
  select c.profile_id, p.meta -> 'shipping' into v_profile, s from public.customers c left join public.profiles p on p.id = c.profile_id where c.id = v_c;
  if s is null or jsonb_typeof(s) <> 'object' then return jsonb_build_object('adoptado', false, 'motivo', 'sin_domicilio_de_alta'); end if;
  if nullif(btrim(coalesce(s ->> 'line1', '')), '') is null or coalesce(s ->> 'cp', '') !~ '^[0-9]{5}$' or nullif(btrim(coalesce(s ->> 'city', '')), '') is null or nullif(btrim(coalesce(s ->> 'state', '')), '') is null then
    return jsonb_build_object('adoptado', false, 'motivo', 'incompleto');
  end if;
  if exists (select 1 from public.doctor_locations l where l.active and (l.customer_id = v_c or l.doctor_id = v_profile) and lower(btrim(l.line1)) = lower(btrim(s ->> 'line1')) and l.postal_code = s ->> 'cp') then
    return jsonb_build_object('adoptado', false, 'motivo', 'ya_existe');
  end if;
  r := public.cliente_ubicacion_guardar(v_c, null, jsonb_build_object('tipo', 'OTRO', 'name', 'Domicilio del registro', 'line1', s ->> 'line1', 'neighborhood', s ->> 'colonia', 'postal_code', s ->> 'cp',
                                         'city', s ->> 'city', 'state', s ->> 'state', 'contact_phone', s ->> 'phone'), null);
  perform public._c360_evento(v_c, 'domicilio_adoptado_alta', jsonb_build_object('domicilio_id', r ->> 'id'), a);
  return jsonb_build_object('adoptado', true, 'id', r ->> 'id');
end;
$$;

-- ── 7) Perfiles fiscales ─────────────────────────────────────────────────────
-- Espejo de compatibilidad: customers.meta.fiscal = predeterminado activo (lo escribe SOLO el servidor).
create or replace function public._c360_espejo_fiscal(p_customer uuid) returns void
  language plpgsql set search_path = public as
$$
declare f record;
begin
  select * into f from public.customer_fiscal_profiles where customer_id = p_customer and es_predeterminado and activo;
  if found then
    update public.customers set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{fiscal}', jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion), true), updated_at = now()
     where id = p_customer;
  else
    update public.customers set meta = coalesce(meta, '{}'::jsonb) - 'fiscal', updated_at = now() where id = p_customer and meta ? 'fiscal';
  end if;
end;
$$;

create or replace function public._c360_fiscal_predeterminar(p_customer uuid, p_perfil uuid) returns void
  language sql set search_path = public as
$$
  update public.customer_fiscal_profiles set es_predeterminado = false, updated_at = now() where customer_id = p_customer and es_predeterminado and activo and id <> p_perfil;
  update public.customer_fiscal_profiles set es_predeterminado = true, updated_at = now() where id = p_perfil;
$$;

create or replace function public.cliente_fiscal_guardar(p_customer uuid, p_perfil uuid, p_datos jsonb, p_predeterminado boolean default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text; v_err text; v jsonb; v_alias text; v_id uuid; v_primero boolean; f record;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'facturacion', 'dueno']);
  v_err := public._fiscal_error(p_datos);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err using errcode = 'check_violation'; end if;
  v := public._fiscal_clean(p_datos);
  v_alias := coalesce(nullif(btrim(coalesce(p_datos ->> 'alias', '')), ''), left(v ->> 'razon_social', 80));
  if length(v_alias) > 80 then raise exception 'FISCAL_INVALIDO: alias demasiado largo' using errcode = 'check_violation'; end if;
  perform 1 from public.customers where id = v_c for update;
  v_primero := not exists (select 1 from public.customer_fiscal_profiles where customer_id = v_c and activo and id is distinct from p_perfil);
  if p_perfil is null then
    insert into public.customer_fiscal_profiles (customer_id, alias, rfc, razon_social, regimen, cp, uso_cfdi, email_facturacion, created_by, updated_by)
    values (v_c, v_alias, v ->> 'rfc', v ->> 'razon_social', v ->> 'regimen', v ->> 'cp', v ->> 'uso_cfdi', v ->> 'email_facturacion', auth.uid(), auth.uid()) returning id into v_id;
    perform public._c360_evento(v_c, 'fiscal_agregado', jsonb_build_object('perfil_id', v_id), a);
  else
    select * into f from public.customer_fiscal_profiles where id = p_perfil and customer_id = v_c for update;
    if not found then raise exception 'PERFIL_FISCAL_INEXISTENTE' using errcode = 'check_violation'; end if;
    if not f.activo then raise exception 'PERFIL_FISCAL_ARCHIVADO: un perfil archivado no se edita' using errcode = 'check_violation'; end if;
    update public.customer_fiscal_profiles set alias = v_alias, rfc = v ->> 'rfc', razon_social = v ->> 'razon_social', regimen = v ->> 'regimen', cp = v ->> 'cp', uso_cfdi = v ->> 'uso_cfdi',
           email_facturacion = v ->> 'email_facturacion', updated_at = now(), updated_by = auth.uid() where id = p_perfil;
    v_id := p_perfil;
    perform public._c360_evento(v_c, 'fiscal_actualizado', jsonb_build_object('perfil_id', v_id), a);
  end if;
  if coalesce(p_predeterminado, false) or v_primero then perform public._c360_fiscal_predeterminar(v_c, v_id); end if;
  perform public._c360_espejo_fiscal(v_c);
  return jsonb_build_object('id', v_id, 'customer_id', v_c);
end;
$$;

create or replace function public.cliente_fiscal_predeterminar(p_perfil uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare f record; a text;
begin
  select * into f from public.customer_fiscal_profiles where id = p_perfil;
  if not found then raise exception 'PERFIL_FISCAL_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(f.customer_id, array['direccion', 'facturacion', 'dueno']);
  perform 1 from public.customers where id = f.customer_id for update;
  select * into f from public.customer_fiscal_profiles where id = p_perfil;
  if not f.activo then raise exception 'PERFIL_FISCAL_ARCHIVADO' using errcode = 'check_violation'; end if;
  if f.es_predeterminado then return jsonb_build_object('id', f.id, 'idempotente', true); end if;
  perform public._c360_fiscal_predeterminar(f.customer_id, f.id);
  perform public._c360_espejo_fiscal(f.customer_id);
  perform public._c360_evento(f.customer_id, 'fiscal_predeterminado', jsonb_build_object('perfil_id', f.id), a);
  return jsonb_build_object('id', f.id, 'idempotente', false);
end;
$$;

create or replace function public.cliente_fiscal_archivar(p_perfil uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare f record; a text; v_nuevo uuid;
begin
  select * into f from public.customer_fiscal_profiles where id = p_perfil;
  if not found then raise exception 'PERFIL_FISCAL_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_exige(f.customer_id, array['direccion', 'facturacion', 'dueno']);
  perform 1 from public.customers where id = f.customer_id for update;
  select * into f from public.customer_fiscal_profiles where id = p_perfil;
  if not f.activo then return jsonb_build_object('id', f.id, 'idempotente', true); end if;
  update public.customer_fiscal_profiles set activo = false, es_predeterminado = false, updated_at = now(), updated_by = auth.uid() where id = f.id;
  if f.es_predeterminado then
    select id into v_nuevo from public.customer_fiscal_profiles where customer_id = f.customer_id and activo order by created_at, id limit 1;
    if v_nuevo is not null then perform public._c360_fiscal_predeterminar(f.customer_id, v_nuevo); end if;
  end if;
  perform public._c360_espejo_fiscal(f.customer_id);
  perform public._c360_evento(f.customer_id, 'fiscal_archivado', jsonb_build_object('perfil_id', f.id, 'nuevo_predeterminado', v_nuevo), a);
  return jsonb_build_object('id', f.id, 'nuevo_predeterminado', v_nuevo, 'idempotente', false);
end;
$$;

-- Lectura de perfiles fiscales (checkout y editores). Vendedor: solo alias y RFC enmascarado (mínimo privilegio).
create or replace function public.cliente_perfiles_fiscales(p_customer uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_actor(v_c);
  if a is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object('customer_id', v_c, 'puede_editar', a in ('direccion', 'facturacion', 'dueno', 'servicio'), 'perfiles', coalesce((select jsonb_agg(
    case when a = 'vendedor' then jsonb_build_object('id', f.id, 'alias', f.alias, 'rfc', left(f.rfc, 3) || repeat('*', length(f.rfc) - 6) || right(f.rfc, 3), 'es_predeterminado', f.es_predeterminado)
         else jsonb_build_object('id', f.id, 'alias', f.alias, 'rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi,
                                 'email_facturacion', f.email_facturacion, 'es_predeterminado', f.es_predeterminado, 'updated_at', f.updated_at) end
    order by f.es_predeterminado desc, f.created_at) from public.customer_fiscal_profiles f where f.customer_id = v_c and f.activo), '[]'::jsonb));
end;
$$;

-- ── 8) Modelo de lectura Customer 360 (servidor; redacción por rol) ───────────
create or replace function public.cliente_360(p_customer uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_c uuid := public._c360_cliente(p_customer); a text; c record; p record; k record; v record; conv record; cart record; r jsonb; v_ids uuid[];
  completo boolean; comercial boolean; vend boolean;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  a := public._c360_actor(v_c);
  if a is null then raise exception 'NO_AUTORIZADO: no puedes ver este cliente' using errcode = 'insufficient_privilege'; end if;
  completo := a in ('direccion', 'servicio'); vend := a = 'vendedor'; comercial := completo or vend;
  select * into c from public.customers where id = v_c;
  select * into p from public.profiles where id = c.profile_id;
  select k2.seller_profile_id, k2.asignado_at, coalesce(s.meta ->> 'name', s.full_name, s.email) as nombre, public._cc_vendedor_elegible(k2.seller_profile_id, false) as elegible
    into k from public.cc_cartera k2 left join public.profiles s on s.id = k2.seller_profile_id where k2.profile_id = c.profile_id;
  select array_agg(o.id) into v_ids from public.orders o where o.customer_id = v_c;

  r := jsonb_build_object('customer_id', v_c, 'rol', a, 'permisos', jsonb_build_object(
          'contacto', case a when 'direccion' then '["full_name","email","city","country"]'::jsonb when 'servicio' then '["full_name","email","city","country"]'::jsonb
                             when 'vendedor' then '["email","city","country"]'::jsonb when 'dueno' then '["city","country"]'::jsonb else '[]'::jsonb end,
          'telefonos', a in ('direccion', 'vendedor', 'dueno', 'servicio'), 'domicilios', a in ('direccion', 'vendedor', 'dueno', 'servicio'),
          'fiscal', a in ('direccion', 'facturacion', 'dueno', 'servicio'), 'notas', a in ('direccion', 'vendedor', 'servicio'), 'cartera', completo,
          'adoptar_alta', a in ('direccion', 'dueno', 'servicio')));

  -- RESUMEN / CONTACTO
  r := r || jsonb_build_object('resumen', jsonb_build_object(
          'nombre', c.full_name, 'activo', c.active, 'creado_at', c.created_at, 'origen', c.source,
          'portal', jsonb_build_object('tiene', c.profile_id is not null, 'verificado', coalesce(p.verified, false), 'activo', coalesce(p.active, false), 'profile_id', case when completo then c.profile_id end),
          'vendedor', case when k.seller_profile_id is null then null else jsonb_build_object('id', case when comercial then k.seller_profile_id end, 'nombre', k.nombre, 'desde', k.asignado_at, 'elegible', k.elegible) end,
          'vendedor_historico', case when completo then c.seller_name end),
       'contacto', jsonb_build_object('email', c.email, 'ciudad', c.city, 'pais', c.country, 'email_portal', case when completo then p.email end,
          'telefonos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'numero', t.numero, 'etiqueta', t.etiqueta, 'es_principal', t.es_principal, 'origen', t.origen) order by t.es_principal desc, t.created_at)
                                 from public.customer_phones t where t.customer_id = v_c and t.activo), '[]'::jsonb),
          'alta', case when p.id is not null and p.meta ? 'shipping' then jsonb_build_object('telefono', p.meta -> 'shipping' ->> 'phone', 'ciudad', p.meta -> 'shipping' ->> 'city') end,
          'notas', case when comercial then coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'texto', n.texto, 'autor_rol', n.autor_rol, 'autor', coalesce(ap.meta ->> 'name', ap.full_name), 'at', n.created_at) order by n.created_at desc)
                                 from (select * from public.customer_notes where customer_id = v_c order by created_at desc limit 50) n left join public.profiles ap on ap.id = n.autor_profile_id), '[]'::jsonb) end,
          'nota_legada', case when comercial then nullif(c.meta ->> 'notes', '') end));

  -- DOMICILIOS (canónicos + alta legacy si no se ha adoptado)
  r := r || jsonb_build_object('domicilios', jsonb_build_object(
          'lista', coalesce((select jsonb_agg(to_jsonb(l) - 'doctor_id' - 'customer_id' order by l.is_default desc, l.created_at) from public.doctor_locations l
                             where l.active and (l.customer_id = v_c or (c.profile_id is not null and l.doctor_id = c.profile_id))), '[]'::jsonb),
          'archivados', (select count(*) from public.doctor_locations l where not l.active and (l.customer_id = v_c or (c.profile_id is not null and l.doctor_id = c.profile_id))),
          'alta', case when p.id is not null and jsonb_typeof(p.meta -> 'shipping') = 'object' then (p.meta -> 'shipping') - 'phone' end));

  -- FACTURACIÓN (vendedor: enmascarado; nadie más fuera de los roles)
  r := r || jsonb_build_object('facturacion', (public.cliente_perfiles_fiscales(v_c)) -> 'perfiles');

  -- PROFESIONAL / VERIFICACIÓN (solo Dirección; sin evidencia biométrica)
  if completo and p.id is not null then
    r := r || jsonb_build_object('profesional', jsonb_build_object('cedula', p.meta ->> 'cedula', 'organizacion', coalesce(p.organization, c.meta ->> 'organization'), 'especialidad', p.meta ->> 'specialty',
            'verificado', p.verified, 'verification', p.meta -> 'verification', 'sep', (p.meta -> 'verifyResult') - 'raw' - 'payload',
            'identidad', case when jsonb_typeof(p.meta -> 'identity') = 'object' then jsonb_build_object('status', p.meta -> 'identity' ->> 'status', 'live', p.meta -> 'identity' -> 'live', 'ineValid', p.meta -> 'identity' -> 'ineValid', 'faceMatch', p.meta -> 'identity' -> 'faceMatch', 'provider', p.meta -> 'identity' ->> 'provider', 'unavailable', p.meta -> 'identity' -> 'unavailable') end,
            'ultimo_acceso', (select to_jsonb(u) ->> 'last_sign_in_at' from auth.users u where u.id = p.id)));
  end if;

  -- COMERCIAL (CC-7: cartera canónica; atribución aparte; conversación y carrito)
  if comercial then
    select cv.id, cv.modo, cv.estado, cv.last_message_at, cv.handoff_origen, cv.ruteo_motivo, (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = cv.seller_profile_id) as asesor
      into conv from public.cc_conversations cv where cv.profile_id = c.profile_id and c.profile_id is not null order by (cv.estado = 'abierta') desc, cv.last_message_at desc nulls last limit 1;
    select kk.id, kk.handoff_estado, (select count(*) from public.cc_cart_items i where i.cart_id = kk.id) as n_items into cart from public.cc_carts kk where kk.profile_id = c.profile_id and kk.estado = 'active' and c.profile_id is not null;
    r := r || jsonb_build_object('comercial', jsonb_build_object(
          'historial', case when completo then coalesce((select jsonb_agg(jsonb_build_object('anterior', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = h.seller_anterior),
                                   'nuevo', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = h.seller_nuevo), 'motivo', h.motivo, 'at', h.created_at) order by h.created_at desc)
                                   from public.cc_cartera_historial h where h.profile_id = c.profile_id), '[]'::jsonb) end,
          'atribucion', jsonb_build_object('origen', c.source,
              'referido', (select jsonb_build_object('vendedor', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = vi.seller_profile_id), 'primer_contacto', vi.first_touch, 'at', vi.first_touch_at)
                             from public.cc_visitors vi where vi.adopted_profile_id = c.profile_id and c.profile_id is not null order by vi.adopted_at desc limit 1),
              'prospecto', (select jsonb_build_object('fuente', pr.source, 'estado', pr.status, 'at', pr.created_at) from public.prospects pr where pr.customer_id = v_c order by pr.created_at desc limit 1)),
          'conversacion', case when conv.id is null then null else jsonb_build_object('id', conv.id, 'modo', conv.modo, 'estado', conv.estado, 'ultimo_mensaje_at', conv.last_message_at, 'origen', conv.handoff_origen, 'ruteo_motivo', conv.ruteo_motivo, 'asesor', conv.asesor) end,
          'carrito', case when cart.id is null then null else jsonb_build_object('id', cart.id, 'n_items', cart.n_items, 'handoff', cart.handoff_estado) end));
  end if;

  -- PEDIDOS (por customer_id) + PAGOS (verdad W2) + FACTURAS (verdad W3)
  r := r || jsonb_build_object('pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'folio', o.external_ref, 'fecha', o.created_at, 'estado', o.status, 'total', o.total,
              'estado_pago', m.estado_pago, 'cobrado', case when a <> 'vendedor' then m.cobrado_neto end, 'saldo', m.saldo, 'factura_solicitada', o.invoice_requested) order by o.created_at desc)
            from (select * from public.orders where customer_id = v_c order by created_at desc limit 100) o left join public.v_order_money m on m.order_id = o.id), '[]'::jsonb),
       'resumen_pedidos', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(o.total), 0), 'ultimo', max(o.created_at)) from public.orders o where o.customer_id = v_c and coalesce(o.status, '') not in ('cancelled', 'canceled', 'cancelado')));
  if a <> 'vendedor' then
    r := r || jsonb_build_object('pagos', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'fecha', e.value_date, 'direccion', e.direction, 'metodo', e.method, 'monto', e.amount, 'moneda', e.currency) order by e.created_at desc)
              from (select * from public.payment_entries where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 100) e join public.orders o on o.id = e.order_id), '[]'::jsonb),
         'pagos_reportados', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'fecha', pc.declared_at, 'metodo', pc.method, 'monto', pc.amount_declared, 'estado', pc.status) order by pc.created_at desc)
              from (select * from public.payment_claims where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 50) pc join public.orders o on o.id = pc.order_id), '[]'::jsonb));
  end if;
  r := r || jsonb_build_object('facturas', coalesce((select jsonb_agg(jsonb_build_object('pedido', o.external_ref, 'tipo', f.kind, 'estado', f.status, 'uuid', f.uuid, 'serie', f.serie, 'folio', f.folio, 'total', f.total,
              'fecha', coalesce(f.provider_stamped_at, f.created_at), 'receptor_rfc', case when a <> 'vendedor' then f.receiver ->> 'rfc' end) order by f.created_at desc)
            from (select * from public.fiscal_documents where order_id = any (coalesce(v_ids, '{}')) order by created_at desc limit 100) f join public.orders o on o.id = f.order_id), '[]'::jsonb));

  -- ACTIVIDAD (eventos reales; sin valores personales ni telemetría de seguridad)
  if a in ('direccion', 'servicio', 'vendedor') then
    r := r || jsonb_build_object('actividad', coalesce((select jsonb_agg(s.x order by s.at desc) from (
        select e.created_at as at, jsonb_build_object('at', e.created_at, 'tipo', e.tipo, 'actor_rol', e.actor_rol, 'actor', coalesce(ap.meta ->> 'name', ap.full_name)) as x
          from public.customer_events e left join public.profiles ap on ap.id = e.actor_profile_id
         where e.customer_id = v_c and (a <> 'vendedor' or e.tipo not like 'fiscal%')
        union all
        select h.created_at, jsonb_build_object('at', h.created_at, 'tipo', 'cartera_' || case when h.seller_nuevo is null then 'retirada' when h.seller_anterior is null then 'asignada' else 'reasignada' end, 'actor_rol', 'direccion', 'actor', null)
          from public.cc_cartera_historial h where h.profile_id = c.profile_id and c.profile_id is not null and a <> 'vendedor'
        union all
        select o.created_at, jsonb_build_object('at', o.created_at, 'tipo', 'pedido_creado', 'actor_rol', null, 'actor', o.external_ref) from public.orders o where o.customer_id = v_c
        order by 1 desc limit 60) s), '[]'::jsonb));
  end if;
  return r;
end;
$$;

-- ── 9) Redefiniciones (texto vigente + parches mínimos) ─────────────────────────
create or replace function public.upsert_customer_fiscal(p_customer_id uuid, p_fiscal jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- C360-F3 · COMPATIBILIDAD: escribe el perfil fiscal PREDETERMINADO canónico (customer_fiscal_profiles; lo crea
-- si no hay). Autoridad: Dirección, facturación y el doctor dueño (pos ya NO edita fiscal).
declare v_err text; v_clean jsonb; v_def uuid;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then raise exception 'CLIENTE_INEXISTENTE'; end if;
  if coalesce(public._c360_actor(p_customer_id), '') not in ('direccion', 'facturacion', 'dueno', 'servicio') then
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este cliente';
  end if;
  v_err := public._fiscal_error(p_fiscal);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_fiscal);
  select id into v_def from public.customer_fiscal_profiles where customer_id = p_customer_id and es_predeterminado and activo;
  perform public.cliente_fiscal_guardar(p_customer_id, v_def, v_clean, true);
  perform public._fiscal_audit('Perfil fiscal actualizado', 'customer:' || p_customer_id, v_clean);
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end $$;

create or replace function public.upsert_customer_contact(p_customer_id uuid, p_patch jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- C360-F3 · Autoridad acotada: Dirección todo (incl. seller_name, solo referencia histórica); vendedor SOLO su
-- cartera y sin nombre ni seller_name; doctor lo suyo; facturación ya NO edita contacto. El teléfono se refleja
-- en customer_phones (trigger). Cada cambio queda en customer_events (solo nombres de campo).
declare a text; v_meta jsonb; v_campos text[] := '{}'; k text;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;
  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_actor(p_customer_id);
  if a is null or a = 'facturacion' then raise exception 'NO_AUTORIZADO'; end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if nullif(btrim(coalesce(p_patch ->> k, '')), '') is null then continue; end if;
    if k = 'seller_name' and a not in ('direccion', 'servicio') then continue; end if;
    if k = 'full_name' and a = 'vendedor' then continue; end if;
    if k = 'notes' and a = 'dueno' then continue; end if;
    if k in ('full_name', 'email', 'phone', 'city', 'seller_name', 'organization', 'notes') then v_campos := v_campos || k; end if;
  end loop;
  update public.customers set
    full_name  = case when 'full_name' = any (v_campos) then btrim(p_patch->>'full_name') else full_name end,
    email      = case when 'email' = any (v_campos) then btrim(p_patch->>'email') else email end,
    phone      = case when 'phone' = any (v_campos) then btrim(p_patch->>'phone') else phone end,
    city       = case when 'city' = any (v_campos) then btrim(p_patch->>'city') else city end,
    seller_name = case when 'seller_name' = any (v_campos) then btrim(p_patch->>'seller_name') else seller_name end,
    meta = coalesce(meta,'{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'organization', case when 'organization' = any (v_campos) then btrim(p_patch->>'organization') else meta->>'organization' end,
                'notes',        case when 'notes' = any (v_campos) then btrim(p_patch->>'notes') else meta->>'notes' end)),
    updated_at = now()
  where id = p_customer_id;
  if array_length(v_campos, 1) > 0 then perform public._c360_evento(p_customer_id, 'contacto_actualizado', jsonb_build_object('campos', to_jsonb(v_campos), 'via', 'upsert_customer_contact'), a); end if;
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end;
$$;

CREATE OR REPLACE FUNCTION public._w3_receptor(p_order uuid, p_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_meta jsonb; v_doc uuid; v_cust uuid; v_try jsonb; v_email text;
begin
  select o.invoice_meta, o.doctor_id, o.customer_id into v_meta, v_doc, v_cust
    from public.orders o where o.id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  if p_override is not null then
    v_try := public._fiscal_clean(p_override);
    if public._fiscal_error(v_try) is null then return v_try; end if;
    return null;  -- un receptor explícito INVÁLIDO no se sustituye en silencio
  end if;

  v_try := public._fiscal_clean(coalesce(v_meta->'receiver', '{}'::jsonb));
  if public._fiscal_error(v_try) is null then return v_try; end if;

  -- C360-F3 · perfil fiscal PREDETERMINADO canónico del cliente (antes que cualquier legado)
  if v_cust is not null then
    select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_try
      from public.customer_fiscal_profiles f where f.customer_id = v_cust and f.es_predeterminado and f.activo;
    if v_try is not null and public._fiscal_error(v_try) is null then return public._fiscal_clean(v_try); end if;
  end if;

  if v_cust is not null then
    select public._w3_norm_legacy(coalesce(c.meta->'fiscal', '{}'::jsonb)) into v_try
      from public.customers c where c.id = v_cust;
    if public._fiscal_error(v_try) is null then return v_try; end if;
  end if;

  if v_doc is not null then
    select public._w3_norm_legacy(coalesce(p.meta->'fiscal', '{}'::jsonb), p.email) into v_try
      from public.profiles p where p.id = v_doc;
    if public._fiscal_error(v_try) is null then return v_try; end if;
  end if;

  return null;
end;
$function$;

drop function public.cc_checkout_confirmar(uuid, text, integer, boolean);
CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false, p_perfil_fiscal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb; v_cust uuid; v_fiscal jsonb;
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
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (metadata server-derived; NO es comisión ni autoridad económica): CC-7 · la cartera canónica (cc_cartera) o ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, coalesce(p_factura, false), v_cust);
  if coalesce((w1 ->> 'order_id')::uuid, v_order) <> v_order then raise exception 'W1_INCONSISTENTE'; end if;
  if v_fallo = 'despues_w1' then raise exception 'FALLO_INYECTADO: despues_w1'; end if;   -- prueba: nada queda a medias
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric));
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


-- ── 10) Migración de datos (determinista, idempotente) ───────────────────────
-- Teléfonos: cada customers.phone con 7–15 dígitos → teléfono principal (origen 'migracion'). Los que
-- no cumplen formato se quedan solo en customers.phone (visibles como legado) y se reportan.
insert into public.customer_phones (customer_id, numero, numero_norm, etiqueta, es_principal, origen)
select c.id, btrim(c.phone), public._c360_tel_norm(c.phone), 'otro', true, 'migracion'
  from public.customers c
 where nullif(btrim(coalesce(c.phone, '')), '') is not null and public._c360_tel_norm(c.phone) ~ '^[0-9]{7,15}$'
   and length(btrim(c.phone)) between 7 and 30
   and not exists (select 1 from public.customer_phones t where t.customer_id = c.id);
-- Fiscal: customers.meta.fiscal válido → perfil predeterminado (origen 'migracion').
insert into public.customer_fiscal_profiles (customer_id, alias, rfc, razon_social, regimen, cp, uso_cfdi, email_facturacion, es_predeterminado, origen)
select c.id, left(public._fiscal_clean(c.meta -> 'fiscal') ->> 'razon_social', 80), x ->> 'rfc', x ->> 'razon_social', x ->> 'regimen', x ->> 'cp', x ->> 'uso_cfdi', x ->> 'email_facturacion', true, 'migracion'
  from public.customers c, lateral (select public._fiscal_clean(c.meta -> 'fiscal') as x) z
 where c.meta ? 'fiscal' and public._fiscal_error(c.meta -> 'fiscal') is null
   and not exists (select 1 from public.customer_fiscal_profiles f where f.customer_id = c.id);

-- ── 11) Privilegios ──────────────────────────────────────────────────────────
revoke all on function public._c360_actor(uuid), public._c360_cliente(uuid), public._c360_exige(uuid, text[]), public._c360_evento(uuid, text, jsonb, text), public._c360_tel_norm(text),
  public._c360_espejo_tel(uuid), public._c360_tel_desde_customer(), public._c360_cliente_de_ubicacion(uuid), public._c360_ubic_predeterminar(uuid, uuid), public._c360_ubic_validar(jsonb),
  public._c360_espejo_fiscal(uuid), public._c360_fiscal_predeterminar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cliente_telefono_guardar(uuid, uuid, text, text, boolean), public.cliente_telefono_principal(uuid), public.cliente_telefono_archivar(uuid),
  public.cliente_contacto_guardar(uuid, jsonb), public.cliente_nota_agregar(uuid, text), public.cliente_ubicacion_guardar(uuid, uuid, jsonb, boolean), public.cliente_ubicacion_predeterminar(uuid),
  public.cliente_ubicacion_archivar(uuid), public.cliente_ubicacion_adoptar_alta(uuid), public.cliente_fiscal_guardar(uuid, uuid, jsonb, boolean), public.cliente_fiscal_predeterminar(uuid),
  public.cliente_fiscal_archivar(uuid), public.cliente_perfiles_fiscales(uuid), public.cliente_360(uuid) from public, anon;
grant execute on function public.cliente_telefono_guardar(uuid, uuid, text, text, boolean), public.cliente_telefono_principal(uuid), public.cliente_telefono_archivar(uuid),
  public.cliente_contacto_guardar(uuid, jsonb), public.cliente_nota_agregar(uuid, text), public.cliente_ubicacion_guardar(uuid, uuid, jsonb, boolean), public.cliente_ubicacion_predeterminar(uuid),
  public.cliente_ubicacion_archivar(uuid), public.cliente_ubicacion_adoptar_alta(uuid), public.cliente_fiscal_guardar(uuid, uuid, jsonb, boolean), public.cliente_fiscal_predeterminar(uuid),
  public.cliente_fiscal_archivar(uuid), public.cliente_perfiles_fiscales(uuid), public.cliente_360(uuid) to authenticated, service_role;
revoke all on function public.cc_checkout_confirmar(uuid, text, integer, boolean, uuid) from public, anon;
grant execute on function public.cc_checkout_confirmar(uuid, text, integer, boolean, uuid) to authenticated, service_role;

-- ── 12) Verificación final ───────────────────────────────────────────────────
do $post$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and (table_name in ('customer_phones', 'customer_fiscal_profiles', 'customer_notes', 'customer_events') or (table_name = 'doctor_locations' and privilege_type <> 'SELECT'));
  if n <> 0 then raise exception 'C360-F3: % privilegios directos indebidos', n; end if;
  if has_function_privilege('anon', 'public.cliente_360(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public._c360_actor(uuid)', 'EXECUTE') then raise exception 'C360-F3: privilegios de funciones'; end if;
  if pg_get_functiondef('public.upsert_customer_fiscal(uuid,jsonb)'::regprocedure) ~ '''pos''' then raise exception 'C360-F3: pos sigue editando fiscal'; end if;
  if (select count(*) from public.customer_phones where es_principal and activo) <> (select count(distinct customer_id) from public.customer_phones where activo) then raise exception 'C360-F3: principal inconsistente'; end if;
end $post$;
