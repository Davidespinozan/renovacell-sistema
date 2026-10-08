-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CARTERA-P1 (migración 131) · «MI CARTERA» CANÓNICA + «CARTERA HISTÓRICA (ODOO)» SEPARADA
--   · Mi cartera = asignaciones VIGENTES de cc_cartera (CC-7). Antes Clientes la calculaba comparando el texto
--     customers.seller_name (Odoo) con el nombre de la sesión: David (seller_name NULL) no aparecía y la vista
--     divergía de lo que asigna Dirección.
--   · cc_mi_cartera(): el vendedor ACTIVO lee SOLO su cartera; la identidad es auth.uid() (sin parámetro de
--     vendedor: no se puede pedir la cartera de otro). Doctor, almacén, inactivos y anónimos: rechazados.
--   · Cartera histórica = customers.seller_name heredado de Odoo, SOLO por equivalencias EXPLÍCITAS y
--     autorizadas (cc_cartera_historica_equivalencias: nombre Odoo exacto → perfil del vendedor). Igualdad exacta,
--     nunca coincidencias parciales. NO es asignación: no toca cc_cartera ni el ruteo. La tabla nace VACÍA; las
--     equivalencias las registra Dirección (cc_equivalencia_historica_guardar/borrar), auditadas.
--   · Sin cambios a tablas existentes, RLS, Edge ni datos. Las tablas base siguen sin GRANT a authenticated.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_cartera_historica_equivalencias') is not null or to_regprocedure('public.cc_mi_cartera()') is not null then
    raise exception 'CARTERA-P1: ya aplicada';
  end if;
  if to_regclass('public.cc_cartera') is null or to_regprocedure('public._cc7_direccion()') is null then raise exception 'CARTERA-P1: requiere CC-7'; end if;
end $pre$;

-- ── 1) Equivalencias históricas explícitas (nombre de vendedor en Odoo → perfil) ─────────────────────
create table public.cc_cartera_historica_equivalencias (
  seller_name_odoo text primary key constraint ck_cche_nombre check (length(btrim(seller_name_odoo)) between 1 and 200 and seller_name_odoo = btrim(seller_name_odoo)),
  seller_profile_id uuid not null references public.profiles(id),
  autorizado_por uuid references public.profiles(id),
  autorizado_at timestamptz not null default now(),
  motivo text constraint ck_cche_motivo check (motivo is null or length(motivo) <= 200)
);
comment on table public.cc_cartera_historica_equivalencias is 'CARTERA-P1 · Equivalencia EXPLÍCITA y autorizada entre el texto customers.seller_name (Odoo) y el perfil del vendedor. Solo alimenta la vista «Cartera histórica (Odoo)»; NO es asignación (la asignación vigente es cc_cartera).';
create index idx_cche_seller on public.cc_cartera_historica_equivalencias (seller_profile_id);
alter table public.cc_cartera_historica_equivalencias enable row level security;   -- sin políticas: solo por las RPC
revoke all on public.cc_cartera_historica_equivalencias from public, anon, authenticated;

create table public.cc_cartera_historica_eventos (
  id bigint generated always as identity primary key,
  accion text not null constraint ck_cchev_accion check (accion in ('equivalencia_guardada', 'equivalencia_borrada')),
  seller_name_odoo text not null,
  seller_anterior uuid references public.profiles(id),
  seller_nuevo uuid references public.profiles(id),
  actor_profile_id uuid references public.profiles(id),
  motivo text constraint ck_cchev_motivo check (motivo is null or length(motivo) <= 200),
  created_at timestamptz not null default now()
);
create trigger trg_cchev_append_only before update or delete on public.cc_cartera_historica_eventos for each row execute function public._cc_append_only();
alter table public.cc_cartera_historica_eventos enable row level security;
revoke all on public.cc_cartera_historica_eventos from public, anon, authenticated;

-- ── 2) Identidad del vendedor que consulta: perfil activo de ventas (o Dirección), resuelto en el servidor ──
create or replace function public._cc_vendedor_consulta() returns uuid
  language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); p record;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id, role_id, active into p from public.profiles where id = v_uid;
  if not found or p.role_id not in ('pos', 'admin') or p.active is not true then
    raise exception 'NO_AUTORIZADO: la cartera es del personal de ventas activo' using errcode = 'insufficient_privilege';
  end if;
  return v_uid;
end;
$$;

-- ── 3) Mi cartera (canónica): asignaciones vigentes de cc_cartera del vendedor que consulta ─────────────
create or replace function public.cc_mi_cartera() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_seller uuid := public._cc_vendedor_consulta();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
            'profile_id', k.profile_id,
            'customer_id', (select cu.id from public.customers cu where cu.profile_id = k.profile_id order by cu.active desc, cu.created_at limit 1),
            'nombre', coalesce(p.full_name, p.meta ->> 'name', p.email),
            'asignado_at', k.asignado_at) order by coalesce(p.full_name, p.meta ->> 'name', p.email))
          from public.cc_cartera k join public.profiles p on p.id = k.profile_id
         where k.seller_profile_id = v_seller), '[]'::jsonb);
end;
$$;
comment on function public.cc_mi_cartera() is 'CARTERA-P1 · Asignaciones VIGENTES (cc_cartera) del vendedor autenticado. Sin parámetro de vendedor: identidad = auth.uid().';

-- ── 4) Cartera histórica (Odoo): clientes cuyo seller_name es EXACTAMENTE un nombre equivalente del vendedor ──
create or replace function public.cc_mi_cartera_historica() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_seller uuid := public._cc_vendedor_consulta();
begin
  return jsonb_build_object(
    'equivalencias', coalesce((select jsonb_agg(e.seller_name_odoo order by e.seller_name_odoo) from public.cc_cartera_historica_equivalencias e where e.seller_profile_id = v_seller), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('customer_id', cu.id, 'seller_name', cu.seller_name) order by cu.full_name)
                            from public.customers cu
                            join public.cc_cartera_historica_equivalencias e on e.seller_name_odoo = cu.seller_name   -- igualdad EXACTA
                           where e.seller_profile_id = v_seller and cu.active), '[]'::jsonb));
end;
$$;
comment on function public.cc_mi_cartera_historica() is 'CARTERA-P1 · Registros heredados de Odoo (customers.seller_name) por equivalencia EXPLÍCITA del vendedor autenticado. No son asignaciones.';

-- ── 5) Administración de equivalencias (solo Dirección, auditada) ───────────────────────────────────────
create or replace function public.cc_equivalencias_historicas() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'equivalencias', coalesce((select jsonb_agg(jsonb_build_object('seller_name_odoo', e.seller_name_odoo, 'seller_profile_id', e.seller_profile_id,
                       'vendedor', (select coalesce(s.meta ->> 'name', s.full_name, s.email) from public.profiles s where s.id = e.seller_profile_id),
                       'clientes', (select count(*) from public.customers cu where cu.active and cu.seller_name = e.seller_name_odoo),
                       'autorizado_at', e.autorizado_at, 'motivo', e.motivo) order by e.seller_name_odoo)
                     from public.cc_cartera_historica_equivalencias e), '[]'::jsonb),
    'nombres_odoo', coalesce((select jsonb_agg(jsonb_build_object('seller_name_odoo', x.sn, 'clientes', x.n,
                       'equivalente', exists (select 1 from public.cc_cartera_historica_equivalencias e where e.seller_name_odoo = x.sn)) order by x.n desc)
                     from (select cu.seller_name sn, count(*) n from public.customers cu where cu.active and coalesce(btrim(cu.seller_name), '') <> '' group by cu.seller_name) x), '[]'::jsonb));
end;
$$;

create or replace function public.cc_equivalencia_historica_guardar(p_seller_name_odoo text, p_seller uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_ant uuid; v_nombre text := btrim(p_seller_name_odoo);
begin
  perform public._cc7_direccion();
  if v_nombre is null or v_nombre = '' or length(v_nombre) > 200 then raise exception 'EQUIVALENCIA_INVALIDA: nombre de Odoo' using errcode = 'check_violation'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.customers cu where cu.seller_name = v_nombre) then
    raise exception 'EQUIVALENCIA_INVALIDA: ningún cliente tiene ese vendedor en Odoo (debe ser el texto exacto)' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles s where s.id = p_seller and s.role_id = 'pos') then
    raise exception 'EQUIVALENCIA_INVALIDA: el perfil debe ser de ventas' using errcode = 'check_violation';
  end if;
  select seller_profile_id into v_ant from public.cc_cartera_historica_equivalencias where seller_name_odoo = v_nombre for update;
  if v_ant = p_seller then return jsonb_build_object('idempotente', true); end if;
  insert into public.cc_cartera_historica_equivalencias (seller_name_odoo, seller_profile_id, autorizado_por, motivo)
  values (v_nombre, p_seller, auth.uid(), left(btrim(p_motivo), 200))
  on conflict (seller_name_odoo) do update set seller_profile_id = excluded.seller_profile_id, autorizado_por = excluded.autorizado_por, autorizado_at = now(), motivo = excluded.motivo;
  insert into public.cc_cartera_historica_eventos (accion, seller_name_odoo, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  values ('equivalencia_guardada', v_nombre, v_ant, p_seller, auth.uid(), left(btrim(p_motivo), 200));
  return jsonb_build_object('idempotente', false);
end;
$$;

create or replace function public.cc_equivalencia_historica_borrar(p_seller_name_odoo text, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_ant uuid;
begin
  perform public._cc7_direccion();
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  delete from public.cc_cartera_historica_equivalencias where seller_name_odoo = btrim(p_seller_name_odoo) returning seller_profile_id into v_ant;
  if v_ant is null then return jsonb_build_object('borrada', false); end if;
  insert into public.cc_cartera_historica_eventos (accion, seller_name_odoo, seller_anterior, seller_nuevo, actor_profile_id, motivo)
  values ('equivalencia_borrada', btrim(p_seller_name_odoo), v_ant, null, auth.uid(), left(btrim(p_motivo), 200));
  return jsonb_build_object('borrada', true);
end;
$$;

-- ── 6) Permisos: EXECUTE solo para authenticated (cada función valida rol e identidad); nunca anon ─────
revoke all on function public._cc_vendedor_consulta() from public, anon, authenticated;
revoke all on function public.cc_mi_cartera(), public.cc_mi_cartera_historica(), public.cc_equivalencias_historicas(),
  public.cc_equivalencia_historica_guardar(text, uuid, text), public.cc_equivalencia_historica_borrar(text, text) from public, anon;
grant execute on function public.cc_mi_cartera(), public.cc_mi_cartera_historica(), public.cc_equivalencias_historicas(),
  public.cc_equivalencia_historica_guardar(text, uuid, text), public.cc_equivalencia_historica_borrar(text, text) to authenticated;
