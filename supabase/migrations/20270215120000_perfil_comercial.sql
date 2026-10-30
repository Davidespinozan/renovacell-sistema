-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HERRAMIENTAS DEL VENDEDOR · bloque B (30 oct 2026). Clasificar a cada cliente como CLÍNICA o DOCTOR y la ESPECIALIDAD
--   del doctor, para poder mandar difusiones "a todos los doctores" o "a los dermatólogos". Hasta hoy la especialidad solo
--   existía en la cuenta del portal (profiles.meta.specialty) y de 2,173 clientes solo 4 tienen cuenta: por eso "no la
--   tenemos". Ahora vive en la FICHA (customers), tenga cuenta o no.
--   · especialidades: catálogo fijo + "Otra" (decisión del dueño), Dirección agrega más.
--   · customers.tipo_cliente ('doctor' | 'clinica' | null = sin clasificar), especialidad, especialidad_otra.
--   · Lo edita el vendedor del cliente, el jefe de ventas o Dirección (cliente_perfil_comercial_guardar).
--   · mis_clientes_perfil: la cartera del vendedor (todos para jefe/Dirección) con su clasificación, para clasificar rápido.
--   · Solo se clasifica solo lo inequívoco por el nombre ("Clínica…", "…Spa", "Dra. …"); lo demás lo decide una persona.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.especialidades') is not null then raise exception 'BLOQUE-B: ya aplicada'; end if;
  if to_regprocedure('public._jefe_ventas()') is null or to_regprocedure('public._cc_vendedor_de_cliente(uuid)') is null then
    raise exception 'BLOQUE-B: faltan COMISIONES-JEFE o VINCULAR-CLIENTE'; end if;
end $pre$;

create table public.especialidades (
  clave      text primary key,
  nombre     text not null unique,
  orden      integer not null default 100,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ck_esp_clave check (clave ~ '^[a-z0-9_]{2,40}$'),
  constraint ck_esp_nombre check (length(btrim(nombre)) between 2 and 60)
);
alter table public.especialidades enable row level security;
create policy esp_lectura on public.especialidades for select to authenticated using (true);
revoke all on public.especialidades from anon;
grant select on public.especialidades to authenticated;
insert into public.especialidades (clave, nombre, orden) values
  ('medicina_estetica', 'Medicina estética', 10), ('dermatologia', 'Dermatología', 20), ('cirugia_plastica', 'Cirugía plástica', 30),
  ('ginecologia', 'Ginecología', 40), ('medicina_general', 'Medicina general', 50), ('nutricion', 'Nutrición', 60),
  ('odontologia', 'Odontología', 70), ('medicina_deportiva', 'Medicina deportiva', 80), ('otra', 'Otra', 1000);

alter table public.customers
  add column tipo_cliente text constraint ck_cust_tipo check (tipo_cliente in ('doctor', 'clinica')),
  add column especialidad text references public.especialidades(clave) on update cascade,
  add column especialidad_otra text constraint ck_cust_esp_otra check (especialidad_otra is null or length(btrim(especialidad_otra)) between 2 and 60),
  add column perfil_actualizado_at timestamptz,
  add column perfil_actualizado_por uuid references public.profiles(id) on delete set null;
create index idx_customers_tipo on public.customers (tipo_cliente, especialidad) where active;

-- ¿Puede quien llama ver y editar la clasificación de este cliente? Dirección, el jefe de ventas o su vendedor.
create function public._puede_perfil_cliente(p_customer uuid) returns boolean language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and (public.auth_role() = 'admin' or public._jefe_ventas()
          or (public.auth_role() = 'pos' and public._cc_vendedor_de_cliente(p_customer) = auth.uid())) $$;

create function public.cliente_perfil_comercial(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare c record;
begin
  if not public._puede_perfil_cliente(p_customer) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select cu.tipo_cliente, cu.especialidad, cu.especialidad_otra, e.nombre esp_nombre, cu.perfil_actualizado_at,
         (select p.meta ->> 'specialty' from public.profiles p where p.id = cu.profile_id) esp_portal
    into c from public.customers cu left join public.especialidades e on e.clave = cu.especialidad where cu.id = p_customer;
  return jsonb_build_object('tipo', c.tipo_cliente, 'especialidad', c.especialidad, 'especialidad_nombre', case when c.especialidad = 'otra' then c.especialidad_otra else c.esp_nombre end,
    'especialidad_otra', c.especialidad_otra, 'especialidad_portal', c.esp_portal, 'actualizado_at', c.perfil_actualizado_at, 'puede_editar', true);
end;
$$;

create function public.cliente_perfil_comercial_guardar(p_customer uuid, p_tipo text, p_especialidad text, p_otra text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_otra text := nullif(btrim(coalesce(p_otra, '')), '');
begin
  if not public._puede_perfil_cliente(p_customer) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_tipo is not null and p_tipo not in ('doctor', 'clinica') then raise exception 'DATO_INVALIDO:tipo'; end if;
  if p_especialidad is not null and not exists (select 1 from public.especialidades where clave = p_especialidad and activa) then raise exception 'DATO_INVALIDO:especialidad'; end if;
  if p_especialidad = 'otra' and (v_otra is null or length(v_otra) < 2) then raise exception 'DATO_INVALIDO:especialidad_otra'; end if;
  update public.customers set tipo_cliente = p_tipo, especialidad = p_especialidad, especialidad_otra = case when p_especialidad = 'otra' then left(v_otra, 60) end,
         perfil_actualizado_at = now(), perfil_actualizado_por = auth.uid(), updated_at = now()
   where id = p_customer;
  return public.cliente_perfil_comercial(p_customer);
end;
$$;

-- Clientes de quien llama (vendedor: su cartera; jefe/Dirección: todos) con su clasificación, para clasificar rápido.
create function public.mis_clientes_perfil(p_q text default null, p_solo_sin boolean default true, p_limite integer default 50, p_offset integer default 0) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_todos boolean; v_q text := nullif(btrim(translate(lower(coalesce(p_q, '')), 'áéíóúñ', 'aeioun')), '');
begin
  if v_uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_todos := public.auth_role() = 'admin' or public._jefe_ventas();
  return (
    with mios as (
      select cu.* from public.customers cu
       where cu.active and (v_todos or public._cc_vendedor_de_cliente(cu.id) = v_uid)),
    filtrados as (
      select m.* from mios m
       where (not coalesce(p_solo_sin, true) or m.tipo_cliente is null)
         and (v_q is null or translate(lower(m.full_name), 'áéíóúñ', 'aeioun') like '%' || v_q || '%'))
    select jsonb_build_object(
      'total', (select count(*) from mios), 'clasificados', (select count(*) from mios where tipo_cliente is not null),
      'doctores', (select count(*) from mios where tipo_cliente = 'doctor'), 'clinicas', (select count(*) from mios where tipo_cliente = 'clinica'),
      'encontrados', (select count(*) from filtrados),
      'clientes', coalesce((select jsonb_agg(jsonb_build_object('customer_id', f.id, 'nombre', f.full_name, 'ciudad', f.city, 'tipo', f.tipo_cliente,
                    'especialidad', f.especialidad, 'especialidad_otra', f.especialidad_otra) order by f.full_name)
                 from (select * from filtrados order by full_name limit greatest(1, least(coalesce(p_limite, 50), 200)) offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)));
end;
$$;

-- Dirección agrega o desactiva especialidades.
create function public.especialidad_guardar(p_nombre text, p_activa boolean default true) returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'); v_clave text;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_nombre) < 2 or length(v_nombre) > 60 then raise exception 'DATO_INVALIDO:nombre'; end if;
  v_clave := left(btrim(regexp_replace(translate(lower(v_nombre), 'áàäéèëíìïóòöúùüñ', 'aaaeeeiiiooouuun'), '[^a-z0-9]+', '_', 'g'), '_'), 40);
  if v_clave = 'otra' then raise exception 'DATO_INVALIDO:nombre'; end if;
  insert into public.especialidades (clave, nombre, orden, activa) values (v_clave, v_nombre, 500, coalesce(p_activa, true))
  on conflict (clave) do update set nombre = excluded.nombre, activa = excluded.activa;
  return jsonb_build_object('clave', v_clave, 'nombre', v_nombre);
end;
$$;

revoke all on function public._puede_perfil_cliente(uuid) from public, anon, authenticated;
revoke all on function public.cliente_perfil_comercial(uuid), public.cliente_perfil_comercial_guardar(uuid, text, text, text),
  public.mis_clientes_perfil(text, boolean, integer, integer), public.especialidad_guardar(text, boolean) from public, anon;
grant execute on function public.cliente_perfil_comercial(uuid), public.cliente_perfil_comercial_guardar(uuid, text, text, text),
  public.mis_clientes_perfil(text, boolean, integer, integer), public.especialidad_guardar(text, boolean) to authenticated;

-- ── Solo lo inequívoco por el nombre; lo demás lo clasifica una persona ─────────────────────────────
update public.customers set tipo_cliente = 'clinica', perfil_actualizado_at = now()
 where tipo_cliente is null and translate(lower(full_name), 'áéíóúñ', 'aeioun') ~ '\y(clinica|clinic|medspa|spa|hospital|estetica|wellness|skincare|consultorio)\y';
update public.customers set tipo_cliente = 'doctor', perfil_actualizado_at = now()
 where tipo_cliente is null and translate(lower(btrim(full_name)), 'áéíóúñ', 'aeioun') ~ '^(dra?|doctora?)[ .]';
-- La especialidad que el doctor ya dio en su cuenta del portal, si coincide con el catálogo.
update public.customers cu set especialidad = e.clave, tipo_cliente = coalesce(cu.tipo_cliente, 'doctor'), perfil_actualizado_at = now()
  from public.profiles p, public.especialidades e
 where p.id = cu.profile_id and cu.especialidad is null and translate(lower(btrim(p.meta ->> 'specialty')), 'áéíóúñ', 'aeioun') = translate(lower(e.nombre), 'áéíóúñ', 'aeioun');

do $post$ begin
  if to_regprocedure('public.cliente_perfil_comercial_guardar(uuid,text,text,text)') is null or (select count(*) from public.especialidades) < 9 then
    raise exception 'BLOQUE-B: no quedó aplicada'; end if;
end $post$;
