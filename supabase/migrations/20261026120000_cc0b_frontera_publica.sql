-- ============================================================================
-- CC-0B · FRONTERA PÚBLICA: limitador atómico, dedupe indexado, higiene de privilegios.
--
-- Medido en producción (read-only, 5 oct 2026) y reproducido en el arnés:
--   1. Las vistas owner-run actualizables (`catalog_public`, `products_safe`,
--      `doctor_directory`, `staff_directory`, `v_stock_disponible`) tenían INSERT/UPDATE/
--      DELETE concedidos a anon y/o authenticated por los privilegios POR DEFECTO del
--      esquema. Probado: `anon` ejecuta `update catalog_public set name = ...` sobre
--      `products` (P0 ACTIVO: 64 productos reales, llave anon pública en la landing); un
--      doctor verificado ejecuta `update products_safe set price = 1` sobre todos los
--      productos. La RLS protege la tabla, no la vista.
--   2. anon tenía privilegios completos sobre 36 tablas (la RLS los neutralizaba) y
--      EXECUTE sobre `confirmar_entrega`.
--   3. No existía ningún limitador de tasa server-side para assistant/capture-lead/
--      register-doctor; capture-lead leía TODA `prospects` para deduplicar.
--
-- Qué hace (y qué NO):
--   · `rate_limit_buckets` + `rate_limit_hit()` (ventana fija, UPSERT atómico; solo
--     service_role). Sin memoria de isolate, sin infraestructura externa.
--   · `buscar_prospecto_duplicado()` con índices de expresión (misma semántica que el
--     dedupe actual; solo service_role).
--   · Privilegios: anon solo SELECT en catalog_public y landing_content; ninguna vista
--     admite escritura; authenticated conserva INSERT/UPDATE/DELETE únicamente donde
--     existe una política RLS que lo permite; nadie salvo el dueño tiene TRUNCATE/
--     REFERENCES/TRIGGER; los objetos futuros ya no heredan privilegios para anon.
--   · NO cambia la RLS ni ninguna función de negocio; NO toca W1–W6 ni CC-0A.
--
-- Rollback: supabase/rollback/cc0b/99_down.sql (retira los objetos; NO reabre privilegios).
-- ============================================================================

do $pre$
begin
  if to_regclass('public.prospects') is null or to_regclass('public.catalog_public') is null then
    raise exception 'CC0B: faltan objetos base';
  end if;
  if to_regprocedure('public.puede_ver_precio()') is null then
    raise exception 'CC0B: CC-0A no está aplicada (puede_ver_precio)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'CC0B: falta el rol service_role';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) LIMITADOR DE TASA · ventana fija, un renglón por (scope, subject, ventana).
--    `scope`   = qué se limita ('assistant_landing_burst', 'capture_lead', …).
--    `subject` = quién ('uid:<uuid>', 'ip:<hash>', 'global'); lo decide el servidor,
--                nunca el cliente. CC-1 podrá añadir 'visitor:<id>' sin cambiar nada aquí.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  scope        text        not null,
  subject      text        not null,
  window_start timestamptz not null,
  count        bigint      not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (scope, subject, window_start),
  constraint ck_rlb_scope   check (length(scope) between 1 and 80),
  constraint ck_rlb_subject check (length(subject) between 1 and 200)
);
create index if not exists idx_rlb_scope_window on public.rate_limit_buckets (scope, window_start);
alter table public.rate_limit_buckets enable row level security;   -- sin políticas: solo service_role/dueño
revoke all on public.rate_limit_buckets from public, anon, authenticated;
comment on table public.rate_limit_buckets is
  'CC-0B · Contadores del limitador de tasa (ventana fija). Solo el servidor (service_role) los toca vía rate_limit_hit().';

-- Un solo UPSERT: el contador avanza bajo el lock de fila; dos sesiones simultáneas se
-- serializan en el mismo renglón y cada una ve SU conteo. `allowed` = count <= limit, así que
-- a partir del límite todas las peticiones son rechazadas (y siguen contando: quien insiste
-- no "resetea" nada). `p_cost` puede ser negativo para ajustar un cargo estimado.
create or replace function public.rate_limit_hit(
  p_scope text, p_subject text, p_limit int, p_window_secs int, p_cost int default 1
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_start timestamptz; v_count bigint; v_new boolean; v_end timestamptz;
begin
  if p_scope is null or p_subject is null or length(p_scope) not between 1 and 80 or length(p_subject) not between 1 and 200 then
    raise exception 'RL_ARGUMENTOS: scope/subject inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_limit is null or p_limit < 1 or p_window_secs is null or p_window_secs < 1 or p_window_secs > 604800 then
    raise exception 'RL_ARGUMENTOS: límite o ventana inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_cost is null or p_cost < -1000000 or p_cost > 1000000 then
    raise exception 'RL_ARGUMENTOS: costo inválido' using errcode = 'invalid_parameter_value';
  end if;
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_secs) * p_window_secs);
  v_end := v_start + make_interval(secs => p_window_secs);
  insert into public.rate_limit_buckets as b (scope, subject, window_start, count)
  values (p_scope, p_subject, v_start, greatest(p_cost, 0))
  on conflict (scope, subject, window_start)
    do update set count = greatest(b.count + p_cost, 0), updated_at = now()
  returning b.count, (xmax = 0) into v_count, v_new;
  if v_new and p_cost < 0 then
    -- Un ajuste negativo sobre una ventana sin renglón no puede "deber" nada: queda en 0.
    v_count := 0;
  end if;
  if v_new then
    -- Limpieza oportunista y acotada: al abrir una ventana nueva se retiran las ventanas
    -- viejas del mismo scope (índice (scope, window_start); nunca un barrido global).
    delete from public.rate_limit_buckets
     where scope = p_scope and window_start < v_start - make_interval(secs => p_window_secs * 2);
  end if;
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'window_start', v_start,
    'reset_at', v_end,
    'retry_after_secs', greatest(ceil(extract(epoch from (v_end - clock_timestamp())))::int, 1)
  );
end;
$$;
comment on function public.rate_limit_hit(text, text, int, int, int) is
  'CC-0B · Incrementa atómicamente el contador de (scope, subject) en la ventana fija actual y dice si sigue dentro del límite.';
revoke all on function public.rate_limit_hit(text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2) DEDUPE DE PROSPECTOS · indexado, misma regla que capture-lead hoy:
--    correo en minúsculas igual, o teléfono con ≥ 7 dígitos igual (dígitos completos).
--    No revela nada al llamante salvo el id (y solo lo recibe el servidor).
-- ---------------------------------------------------------------------------
create index if not exists idx_prospects_email_lower
  on public.prospects (lower(email)) where email is not null;
create index if not exists idx_prospects_phone_digits
  on public.prospects (regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null;

create or replace function public.buscar_prospecto_duplicado(p_email text, p_phone text) returns uuid
  language sql stable security definer set search_path = public as
$$
  select p.id from public.prospects p
   where (nullif(lower(trim(coalesce(p_email, ''))), '') is not null and lower(p.email) = lower(trim(p_email)))
      or (length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 7
          and regexp_replace(p.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g'))
   order by p.created_at asc
   limit 1;
$$;
comment on function public.buscar_prospecto_duplicado(text, text) is
  'CC-0B · Prospecto existente con el mismo correo (minúsculas) o el mismo teléfono (≥7 dígitos). Solo servidor.';
revoke all on function public.buscar_prospecto_duplicado(text, text) from public, anon, authenticated;
grant execute on function public.buscar_prospecto_duplicado(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) HIGIENE DE PRIVILEGIOS (mapeo previo de consumidores: ver reporte CC-0B).
-- ---------------------------------------------------------------------------
-- 3a) anon: nada, salvo las dos lecturas públicas que la landing usa por REST.
revoke all on all tables in schema public from anon;          -- incluye vistas
revoke all on all sequences in schema public from anon;
revoke execute on function public.confirmar_entrega(uuid, text, text) from anon;
grant select on public.catalog_public to anon;
grant select on public.landing_content to anon;

-- 3b) vistas: superficies de LECTURA. Ninguna vista admite escritura desde clientes.
do $v$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', r.relname);
  end loop;
end $v$;

-- 3c) tablas: TRUNCATE/REFERENCES/TRIGGER nunca se usan desde PostgREST; INSERT/UPDATE/
--     DELETE solo donde una política RLS para authenticated (o public) lo contempla.
do $t$
declare r record; v_cmd text;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
    foreach v_cmd in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if not exists (
        select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = r.relname
           and p.cmd in (v_cmd, 'ALL')
           and (p.roles && array['authenticated', 'public']::name[])
      ) then
        execute format('revoke %s on public.%I from authenticated', v_cmd, r.relname);
      end if;
    end loop;
  end loop;
end $t$;

-- 3d) Objetos futuros: anon ya no hereda nada por defecto (tablas, vistas, secuencias,
--     funciones). authenticated conserva el default (decisión del dueño: ver reporte).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- 4) Verificación final: abortar si el estado no es el diseñado.
-- ---------------------------------------------------------------------------
do $post$
declare n int; r record;
begin
  -- vistas sin escritura
  select count(*) into n from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = g.table_schema
   where g.table_schema = 'public' and c.relkind = 'v' and g.grantee in ('anon', 'authenticated')
     and g.privilege_type <> 'SELECT';
  if n <> 0 then raise exception 'CC0B: % privilegios de escritura sobre vistas siguen concedidos', n; end if;
  -- anon: exactamente dos lecturas
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and not (privilege_type = 'SELECT' and table_name in ('catalog_public', 'landing_content'));
  if n <> 0 then raise exception 'CC0B: anon conserva % privilegios fuera de la lista', n; end if;
  if not has_table_privilege('anon', 'public.catalog_public', 'SELECT') or not has_table_privilege('anon', 'public.landing_content', 'SELECT') then
    raise exception 'CC0B: anon perdió las lecturas públicas';
  end if;
  -- nadie salvo el dueño: truncate/references/trigger
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  if n <> 0 then raise exception 'CC0B: % privilegios TRUNCATE/REFERENCES/TRIGGER siguen concedidos', n; end if;
  -- escrituras de authenticated solo con política
  for r in select g.table_name, g.privilege_type from information_schema.role_table_grants g
            join pg_class c on c.relname = g.table_name join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
           where g.table_schema = 'public' and g.grantee = 'authenticated' and c.relkind = 'r'
             and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE') loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name
                     and p.cmd in (r.privilege_type, 'ALL') and (p.roles && array['authenticated', 'public']::name[])) then
      raise exception 'CC0B: authenticated conserva % sobre % sin política', r.privilege_type, r.table_name;
    end if;
  end loop;
  -- limitador y dedupe: solo service_role
  if has_function_privilege('anon', 'public.rate_limit_hit(text,text,int,int,int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rate_limit_hit(text,text,int,int,int)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.rate_limit_hit(text,text,int,int,int)', 'EXECUTE') then
    raise exception 'CC0B: privilegios de rate_limit_hit incorrectos';
  end if;
  if has_function_privilege('anon', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.buscar_prospecto_duplicado(text,text)', 'EXECUTE') then
    raise exception 'CC0B: privilegios de buscar_prospecto_duplicado incorrectos';
  end if;
  if has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'EXECUTE') then
    raise exception 'CC0B: anon conserva EXECUTE sobre confirmar_entrega';
  end if;
  -- defaults para anon retirados
  if exists (select 1 from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
              where ns.nspname = 'public' and d.defaclrole = 'postgres'::regrole and d.defaclacl::text like '%anon=%') then
    raise exception 'CC0B: los privilegios por defecto siguen incluyendo a anon';
  end if;
  -- RLS activa en todas las tablas
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if n <> 0 then raise exception 'CC0B: % tablas sin RLS', n; end if;
end $post$;
