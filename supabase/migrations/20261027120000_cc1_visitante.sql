-- ============================================================================
-- CC-1 · VISITANTE / ATRIBUCIÓN / ADOPCIÓN — identidad canónica PRE-AUTH.
--
-- Cadena: visitante anónimo → visitante atribuido → prospecto → cuenta → doctor no
-- verificado → doctor verificado → customer. Aquí se construye el primer eslabón y la
-- forma SEGURA de que una cuenta se apropie de lo que un visitante hizo antes de existir.
--
-- Invariantes (V1–V20 del diseño; los que la base puede sostener, los sostiene la base):
--   · El visitante se identifica por la POSESIÓN de un token opaco; la base guarda solo
--     su SHA-256 (hex). Correo y teléfono son datos de contacto, nunca identidad.
--   · La adopción exige: cuenta autenticada y activa (el servidor deriva el perfil del JWT),
--     y prueba de posesión: el hash del token, o el vínculo que el registro dejó con ese
--     mismo token (`pending_profile_id`). Idempotente. Un visitante pertenece a UN perfil;
--     un perfil puede adoptar muchos visitantes (varios dispositivos).
--   · first_touch es inmutable una vez capturado; last_touch solo cambia con una visita
--     atribuible (utm/gclid/fbclid/referrer externo), nunca por refresh ni navegación directa.
--   · El vendedor de referido se resuelve en el servidor desde un código opaco; el cliente
--     nunca manda seller_profile_id.
--   · Nada aquí toca verified, precio, dinero, inventario ni pedidos.
--
-- Rollback: supabase/rollback/cc1/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.prospects') is null or to_regclass('public.profiles') is null then raise exception 'CC1: faltan tablas base'; end if;
  if to_regprocedure('public.rate_limit_hit(text,text,int,int,int)') is null then raise exception 'CC1: CC-0B no está aplicada (rate_limit_hit)'; end if;
  if to_regprocedure('public.buscar_prospecto_duplicado(text,text)') is null then raise exception 'CC1: falta buscar_prospecto_duplicado (CC-0B)'; end if;
  if to_regprocedure('extensions.digest(text,text)') is null then raise exception 'CC1: falta pgcrypto en el esquema extensions'; end if;
  if to_regclass('public.cc_visitors') is not null then raise exception 'CC1: cc_visitors ya existe'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) TABLAS
-- ---------------------------------------------------------------------------
create table public.cc_visitors (
  id                 uuid primary key default gen_random_uuid(),
  token_hash         text not null unique,
  estado             text not null default 'activo',
  first_touch        jsonb,
  first_touch_at     timestamptz,
  last_touch         jsonb,
  last_touch_at      timestamptz,
  referral_code      text,
  seller_profile_id  uuid references public.profiles(id) on delete set null,
  pending_profile_id uuid references public.profiles(id) on delete set null,
  pending_at         timestamptz,
  adopted_profile_id uuid references public.profiles(id) on delete set null,
  adopted_at         timestamptz,
  visitas            integer not null default 1,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  constraint ck_ccv_hash    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_ccv_estado  check (estado in ('activo', 'adoptado', 'revocado')),
  constraint ck_ccv_adopcion check ((estado = 'adoptado') = (adopted_profile_id is not null)),
  constraint ck_ccv_ref     check (referral_code is null or referral_code ~ '^[A-Z2-7]{8}$')
);
create index idx_ccv_adopted on public.cc_visitors (adopted_profile_id) where adopted_profile_id is not null;
create index idx_ccv_pending on public.cc_visitors (pending_profile_id) where pending_profile_id is not null;
create index idx_ccv_last_seen on public.cc_visitors (last_seen_at) where estado = 'activo';
comment on table public.cc_visitors is
  'CC-1 · Identidad PRE-AUTH. Solo el hash del token (nunca el token, nunca IP ni user-agent). Se opera solo por comandos.';

create table public.cc_visitor_events (
  id               bigint generated always as identity primary key,
  visitor_id       uuid not null references public.cc_visitors(id) on delete cascade,
  tipo             text not null,
  detalle          jsonb,
  actor_profile_id uuid,
  created_at       timestamptz not null default now(),
  constraint ck_ccve_tipo check (tipo in ('abierto', 'last_touch', 'prospecto', 'registro', 'adoptado', 'conflicto', 'revocado'))
);
create index idx_ccve_visitor on public.cc_visitor_events (visitor_id, created_at);
comment on table public.cc_visitor_events is 'CC-1 · Bitácora append-only del visitante (trazabilidad de adopción y atribución; sin PII).';

create table public.cc_referral_codes (
  code              text primary key,
  seller_profile_id uuid not null references public.profiles(id) on delete cascade,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  revoked_at        timestamptz,
  constraint ck_ccrc_code check (code ~ '^[A-Z2-7]{8}$')
);
comment on table public.cc_referral_codes is 'CC-1 · Código opaco → vendedor. Solo atribuye; no concede permisos. Se resuelve en el servidor.';

alter table public.prospects add column if not exists visitor_id uuid references public.cc_visitors(id) on delete set null;
create index if not exists idx_prospects_visitor on public.prospects (visitor_id) where visitor_id is not null;

-- Append-only para la bitácora.
create or replace function public._cc_append_only() returns trigger
  language plpgsql set search_path = public as
$$
begin
  -- La purga de visitantes (cc_visitantes_purgar) borra en cascada su bitácora: es el único
  -- camino de borrado permitido y lo marca con app.cc_purga. Nada más edita ni borra.
  if tg_op = 'DELETE' and coalesce(current_setting('app.cc_purga', true), '') = 'on' then return old; end if;
  raise exception 'APPEND_ONLY: la bitácora del visitante no se edita ni se borra';
end
$$;
create trigger trg_ccve_append_only before update or delete on public.cc_visitor_events
  for each row execute function public._cc_append_only();

-- RLS encendida, sin políticas: ningún cliente lee ni escribe directamente.
alter table public.cc_visitors enable row level security;
alter table public.cc_visitor_events enable row level security;
alter table public.cc_referral_codes enable row level security;
revoke all on public.cc_visitors, public.cc_visitor_events, public.cc_referral_codes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) HELPERS
-- ---------------------------------------------------------------------------
-- Atribución: lista blanca de claves, texto plano acotado, sin query en URLs.
create or replace function public._cc_attr_limpia(p jsonb) returns jsonb
  language sql immutable set search_path = public as
$$
  select coalesce((
    select jsonb_object_agg(k, v) from (
      select k, left(split_part(btrim(p ->> k), '?', 1), case when k in ('referrer') then 300 when k = 'landing_path' then 200 when k in ('gclid', 'fbclid') then 160 else 120 end) as v
        from unnest(array['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','referrer','landing_path']) k
       where jsonb_typeof(p -> k) = 'string' and btrim(p ->> k) <> ''
    ) s where v <> ''
  ), '{}'::jsonb)
$$;

-- ¿Esta visita trae una señal comercial? (utm/gclid/fbclid, o referrer externo).
create or replace function public._cc_atribuible(p jsonb) returns boolean
  language sql immutable set search_path = public as
$$
  select (p ? 'utm_source') or (p ? 'gclid') or (p ? 'fbclid')
      or ((p ? 'referrer') and (p ->> 'referrer') !~* '(^https?://[^/]*(renovacell\.mx|netlify\.app)|^https?://localhost)')
$$;

-- Teléfono para DEDUPE (no identidad). México: quita +52 / 52 / 521 / 044 / 045 y deja los
-- 10 dígitos nacionales; otros países se conservan tal cual (sus dígitos); < 7 dígitos = nulo.
create or replace function public.norm_telefono_mx(p text) returns text
  language sql immutable set search_path = public as
$$
  select case
    when d is null or length(d) < 7 then null
    when length(d) = 10 then d
    when length(d) = 12 and left(d, 2) = '52' then right(d, 10)
    when length(d) = 13 and left(d, 3) = '521' then right(d, 10)
    when length(d) = 13 and left(d, 3) in ('044', '045') then right(d, 10)
    when length(d) = 14 and left(d, 4) = '0052' then right(d, 10)
    else d end
  from (select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') as d) x
$$;
comment on function public.norm_telefono_mx(text) is 'CC-1 · Normalización para dedupe de contacto (MX: 10 dígitos nacionales; otros: dígitos íntegros). No es identidad.';

-- Dedupe de prospectos: correo en minúsculas o teléfono normalizado (misma función, ambos lados).
drop index if exists public.idx_prospects_phone_digits;
create index if not exists idx_prospects_phone_norm on public.prospects (public.norm_telefono_mx(phone)) where phone is not null;
create or replace function public.buscar_prospecto_duplicado(p_email text, p_phone text) returns uuid
  language sql stable security definer set search_path = public as
$$
  select p.id from public.prospects p
   where (nullif(lower(trim(coalesce(p_email, ''))), '') is not null and lower(p.email) = lower(trim(p_email)))
      or (public.norm_telefono_mx(p_phone) is not null and public.norm_telefono_mx(p.phone) = public.norm_telefono_mx(p_phone))
   order by p.created_at asc
   limit 1;
$$;
revoke all on function public.buscar_prospecto_duplicado(text, text) from public, anon, authenticated;
grant execute on function public.buscar_prospecto_duplicado(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) COMANDOS (SECURITY DEFINER; la autoridad es el servidor: solo service_role)
-- ---------------------------------------------------------------------------
-- Abrir/reanudar. p_hash = hash del token que trae el cliente (o null); p_hash_nuevo = hash
-- del token que el servidor emitirá si hace falta uno. Nunca revela si un token existió.
create or replace function public.cc_visitante_abrir(p_hash text, p_hash_nuevo text, p_attr jsonb default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v public.cc_visitors%rowtype; attr jsonb := public._cc_attr_limpia(coalesce(p_attr, '{}'::jsonb));
  v_seller uuid; v_code text;
begin
  if p_hash_nuevo is null or p_hash_nuevo !~ '^[0-9a-f]{64}$' then
    raise exception 'CC1_ARGUMENTOS: hash nuevo inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_hash is not null and p_hash ~ '^[0-9a-f]{64}$' then
    select * into v from public.cc_visitors where token_hash = p_hash and estado = 'activo' for update;
    if found then
      update public.cc_visitors set
        last_seen_at = now(),
        visitas = least(visitas + 1, 1000000),
        first_touch    = case when first_touch is null and attr <> '{}'::jsonb then attr else first_touch end,
        first_touch_at = case when first_touch is null and attr <> '{}'::jsonb then now() else first_touch_at end,
        last_touch     = case when public._cc_atribuible(attr) and attr is distinct from last_touch then attr else last_touch end,
        last_touch_at  = case when public._cc_atribuible(attr) and attr is distinct from last_touch then now() else last_touch_at end
      where id = v.id;
      if public._cc_atribuible(attr) and attr is distinct from v.last_touch then
        insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'last_touch', attr);
      end if;
      return jsonb_build_object('visitor_id', v.id, 'nuevo', false, 'estado', 'activo');
    end if;
  end if;
  -- Sin token válido (ausente, inventado, revocado o adoptado): visitante NUEVO.
  if p_ref is not null then
    v_code := upper(left(btrim(p_ref), 8));
    select c.seller_profile_id into v_seller
      from public.cc_referral_codes c join public.profiles s on s.id = c.seller_profile_id
     where c.code = v_code and c.activo and s.active and s.role_id = 'pos';
    if v_seller is null then v_code := null; end if;
  end if;
  insert into public.cc_visitors (token_hash, first_touch, first_touch_at, last_touch, last_touch_at, referral_code, seller_profile_id)
  values (p_hash_nuevo,
          case when attr <> '{}'::jsonb then attr end, case when attr <> '{}'::jsonb then now() end,
          case when public._cc_atribuible(attr) then attr end, case when public._cc_atribuible(attr) then now() end,
          v_code, v_seller)
  returning * into v;
  insert into public.cc_visitor_events (visitor_id, tipo, detalle)
  values (v.id, 'abierto', jsonb_build_object('atribuido', public._cc_atribuible(attr), 'referido', v_seller is not null));
  return jsonb_build_object('visitor_id', v.id, 'nuevo', true, 'estado', 'activo');
end;
$$;

-- Vínculo del REGISTRO: el visitante (token poseído) acaba de crear ESTA cuenta. Queda
-- pendiente hasta que la cuenta, ya autenticada, confirme la adopción. Nunca sobrescribe
-- un vínculo de otra cuenta (dos registros desde el mismo visitante = conflicto, se bitacorea).
create or replace function public.cc_visitante_vincular_registro(p_hash text, p_profile uuid) returns boolean
language plpgsql security definer set search_path = public as
$$
declare v public.cc_visitors%rowtype;
begin
  if p_profile is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  if not exists (select 1 from public.profiles where id = p_profile) then return false; end if;
  select * into v from public.cc_visitors where token_hash = p_hash and estado = 'activo' for update;
  if not found then return false; end if;
  if v.pending_profile_id is not null and v.pending_profile_id <> p_profile then
    insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"segundo_registro"}', p_profile);
    return false;
  end if;
  update public.cc_visitors set pending_profile_id = p_profile, pending_at = coalesce(pending_at, now()), last_seen_at = now() where id = v.id;
  insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (v.id, 'registro', p_profile);
  return true;
end;
$$;

-- Liga un prospecto recién creado al visitante que lo originó (solo si no tenía).
create or replace function public.cc_visitante_prospecto(p_hash text, p_prospect uuid) returns boolean
language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  if p_prospect is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select id into v_id from public.cc_visitors where token_hash = p_hash and estado = 'activo';
  if v_id is null then return false; end if;
  update public.prospects set visitor_id = v_id where id = p_prospect and visitor_id is null;
  if not found then return false; end if;
  insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v_id, 'prospecto', jsonb_build_object('prospect_id', p_prospect));
  return true;
end;
$$;

-- ADOPCIÓN. p_profile lo deriva el servidor del JWT (service_role es el único ejecutor).
--   con p_hash: adopta ESE visitante (posesión del token). Si pertenece a otra cuenta devuelve
--   estado 'ajeno' (no lanza: así el intento queda en la bitácora).
--   sin p_hash: adopta los visitantes que quedaron vinculados a este perfil en el registro.
-- Al adoptar, el token se rota a un hash aleatorio: el token viejo deja de servir (V18).
create or replace function public.cc_visitante_adoptar(p_hash text, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record;
begin
  if p_profile is null then raise exception 'CC1_ARGUMENTOS: perfil requerido' using errcode = 'invalid_parameter_value'; end if;
  select id, active, role_id into prof from public.profiles where id = p_profile;
  if not found then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not prof.active then raise exception 'CUENTA_SUSPENDIDA'; end if;

  if p_hash is not null then
    if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'SESION_INVALIDA'; end if;
    select * into v from public.cc_visitors where token_hash = p_hash and estado in ('activo', 'adoptado') for update;
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if v.estado = 'adoptado' then
      if v.adopted_profile_id = p_profile then
        return jsonb_build_object('estado', 'ya_adoptado', 'visitor_id', v.id, 'adoptados', 0);
      end if;
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"adoptado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);   -- se devuelve (no se lanza) para que el conflicto quede en bitácora
    end if;
    if v.pending_profile_id is not null and v.pending_profile_id <> p_profile then
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"registrado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = v.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (v.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'revocado', '{"motivo":"adopcion"}');
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1);
  end if;

  -- Sin token: lo que el registro dejó vinculado a esta cuenta.
  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    n := n + 1;
  end loop;
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n);
end;
$$;

-- Purga de visitantes anónimos nunca adoptados ni vinculados (política: 90 días). Sin cron.
create or replace function public.cc_visitantes_purgar(p_dias int default 90) returns int
language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if p_dias is null or p_dias < 30 then raise exception 'CC1_ARGUMENTOS: la retención mínima es 30 días' using errcode = 'invalid_parameter_value'; end if;
  perform set_config('app.cc_purga', 'on', true);
  delete from public.cc_visitors v
   where v.estado = 'activo' and v.adopted_profile_id is null and v.pending_profile_id is null
     and v.last_seen_at < now() - make_interval(days => p_dias)
     and not exists (select 1 from public.prospects p where p.visitor_id = v.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Códigos de referido: Dirección los crea/revoca (RPC); el cliente nunca los lista.
create or replace function public.cc_codigo_referido_crear(p_seller uuid) returns text
language plpgsql security definer set search_path = public as
$$
declare v_code text; v_alfabeto text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; b bytea; i int;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección crea códigos de referido'; end if;
  if not exists (select 1 from public.profiles where id = p_seller and role_id = 'pos' and active) then
    raise exception 'VENDEDOR_INVALIDO: el código solo puede apuntar a un vendedor activo';
  end if;
  loop
    b := extensions.gen_random_bytes(8); v_code := '';
    for i in 0..7 loop v_code := v_code || substr(v_alfabeto, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.cc_referral_codes where code = v_code);
  end loop;
  insert into public.cc_referral_codes (code, seller_profile_id, created_by) values (v_code, p_seller, auth.uid());
  perform public.log_audit('Código de referido creado', v_code, null, null);
  return v_code;
end;
$$;

create or replace function public.cc_codigo_referido_revocar(p_code text) returns boolean
language plpgsql security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección revoca códigos de referido'; end if;
  update public.cc_referral_codes set activo = false, revoked_at = now() where code = upper(btrim(p_code)) and activo;
  if not found then return false; end if;
  perform public.log_audit('Código de referido revocado', upper(btrim(p_code)), null, null);
  return true;
end;
$$;

-- Privilegios: comandos de servidor solo service_role; referidos para Dirección vía RPC.
revoke all on function public.cc_visitante_abrir(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.cc_visitante_vincular_registro(text, uuid) from public, anon, authenticated;
revoke all on function public.cc_visitante_prospecto(text, uuid) from public, anon, authenticated;
revoke all on function public.cc_visitante_adoptar(text, uuid) from public, anon, authenticated;
revoke all on function public.cc_visitantes_purgar(int) from public, anon, authenticated;
grant execute on function public.cc_visitante_abrir(text, text, jsonb, text), public.cc_visitante_vincular_registro(text, uuid),
  public.cc_visitante_prospecto(text, uuid), public.cc_visitante_adoptar(text, uuid), public.cc_visitantes_purgar(int) to service_role;
revoke all on function public.cc_codigo_referido_crear(uuid), public.cc_codigo_referido_revocar(text) from public, anon;
grant execute on function public.cc_codigo_referido_crear(uuid), public.cc_codigo_referido_revocar(text) to authenticated, service_role;
revoke all on function public._cc_attr_limpia(jsonb), public._cc_atribuible(jsonb), public._cc_append_only() from public, anon;

-- ---------------------------------------------------------------------------
-- 4) Verificación final
-- ---------------------------------------------------------------------------
do $post$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('cc_visitors', 'cc_visitor_events', 'cc_referral_codes');
  if n <> 0 then raise exception 'CC1: % privilegios de cliente sobre tablas cc_*', n; end if;
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relname like 'cc\_%' and c.relkind = 'r' and not c.relrowsecurity) <> 0 then
    raise exception 'CC1: tabla cc_* sin RLS';
  end if;
  if has_function_privilege('authenticated', 'public.cc_visitante_adoptar(text,uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.cc_visitante_abrir(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'CC1: comandos de visitante ejecutables por clientes';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospects' and column_name = 'visitor_id') then
    raise exception 'CC1: prospects.visitor_id ausente';
  end if;
  if public.norm_telefono_mx('+52 (669) 123-4567') <> '6691234567' or public.norm_telefono_mx('6691234567') <> '6691234567'
     or public.norm_telefono_mx('+1 415 555 0101') <> '14155550101' or public.norm_telefono_mx('12345') is not null then
    raise exception 'CC1: norm_telefono_mx no cumple su contrato';
  end if;
end $post$;
