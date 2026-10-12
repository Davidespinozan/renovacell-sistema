-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C4-A (migración 145) · CX-SEC-01 / F3 · BÚSQUEDA MÍNIMA DE CLIENTES PARA VENTAS
--   Primer paso de SEC-C4. ADITIVA: crea una función de búsqueda, tres tablas propias (cuota, excesos, exclusiones) y
--   tres auxiliares. No cambia tablas, políticas, permisos ni funciones existentes. Nadie la consume todavía (el
--   frontend la adopta en C4-B); las políticas de customers / doctor_locations se restringen después (C4-C).
--   Hallazgo que atiende (auditado en producción, reproducido en local): todo Ventas lee customers completo —correo,
--   teléfono, vendedor histórico, metadatos— y lo precarga entero para elegir un cliente.
--   Decisiones del dueño (12 oct 2026):
--     D-C4-1 · la cartera podrá asociarse a customers.id sin exigir cuenta de portal, aprobada por Dirección y con
--              historial (ampliación del modelo; NO se implementa aquí). Hasta entonces, sin cartera = solo búsqueda mínima.
--     D-C4-2 · una equivalencia histórica de Odoo es referencia; no concede acceso a contacto, expediente ni ubicaciones.
--     D-C4-3 · venta de mostrador fuera de cartera: no copiar el teléfono maestro; captura por operación (diseño en C4-E).
--     D-C4-4 · la búsqueda general devuelve SOLO identificador de cuenta, nombre y últimos 4 dígitos enmascarados. Sin ciudad.
--     D-C4-5 · encontrar una cuenta no autoriza su expediente.
--   Endurecimiento tras la auditoría independiente (la primera versión dejaba recuperar ~50 % de un directorio en un día):
--     H1 · máximo 10 resultados por búsqueda. Sin paginación, conteo ni señal de "hay más".
--     H2 · Ventas: 300 FILAS devueltas por día comercial y por usuario. Se descuenta exactamente lo devuelto; si quedan
--          4, se devuelven a lo más 4. Sin resultados no consume filas.
--     H3 · Ventas: 20 búsquedas en CUALQUIER tramo de 60 segundos (ventana deslizante exacta, no por minuto de reloj).
--     H4 · el día comercial es el de America/Mazatlan, aunque el servidor esté en UTC.
--     H5 · una cuenta cuyo "nombre" parece un domicilio no aparece en la búsqueda; un correo usado como nombre no se
--          muestra; c4a_exclusiones permite a Dirección ocultar a mano lo que la detección no reconozca.
--     H6 · los excesos quedan anotados para Dirección (vendedor, día, tipo, intentos). Un rechazo por cuota NO lanza
--          excepción —la revertiría junto con la anotación—: responde vacío con estado HTTP 429 y la transacción se
--          confirma. No se guarda qué se buscó ni qué se devolvió.
--     H7 · una entrada inválida responde vacío con estado HTTP 400, consume frecuencia (no filas) y, pasadas 60 en el
--          día, se trata como abuso (429 y anotación).
--   buscar_clientes_pos(q, limite) → (customer_id, nombre, telefono_mascara)
--     · Quién: Dirección (sin cuotas comerciales) y Ventas, con sesión y rol vigente. Nadie más. La falta de
--       autorización es lo único que se rechaza con excepción, antes de mirar la búsqueda.
--     · Por nombre: 3+ caracteres con alguna letra, hasta 60, sin acentos ni mayúsculas, comodines como texto. Por
--       teléfono: EXACTAMENTE 4 dígitos contra los últimos 4. Sin prefijos, números completos ni correos.
--     · El nombre visible no arrastra contacto; teléfonos de menos de 8 dígitos no se muestran ni se buscan.
--   Para el frontend (C4-B): estado 200 = resultados; 400 = entrada inválida; 429 = cuota. La cabecera
--   X-Busqueda-Estado es solo diagnóstica (el navegador no la ve por CORS).
--   Rollback: supabase/rollback/sec_c4a/99_down.sql (retira solo estos objetos; se pierden el uso y los excesos anotados).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() en su versión auditada y la zona horaria del día comercial.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then
    raise exception 'SEC-C4-A: customers o auth_role() no son los auditados';
  end if;
  if ('2026-10-13 06:59:59+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-12'
     or ('2026-10-13 07:00:00+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-13' then
    raise exception 'SEC-C4-A: la zona America/Mazatlan no se comporta como UTC-7 en este servidor';
  end if;
  -- Ningún objeto de C4-A debe existir (con ninguna firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso'))
     or to_regclass('public.c4a_cuota') is not null or to_regclass('public.c4a_excesos') is not null or to_regclass('public.c4a_exclusiones') is not null then
    raise exception 'SEC-C4-A: los objetos de SEC-C4-A ya existen (ya aplicada o drift)';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

-- ── 1 · Estado de cuota: UNA fila por vendedor ────────────────────────────────────────────────────
--   marcas   = instantes de sus búsquedas de los últimos 60 s (ventana deslizante exacta; nunca más de 20)
--   dia      = día comercial (America/Mazatlan) al que corresponden filas e invalidas
--   filas    = filas de clientes que ya se le devolvieron ese día (tope 300)
--   invalidas= entradas inválidas de ese día
--   Toda búsqueda de Ventas toma el candado de SU fila: sus peticiones simultáneas se atienden una tras otra.
create table public.c4a_cuota (
  user_id    uuid primary key,
  marcas     timestamptz[] not null default '{}',
  dia        date,
  filas      integer not null default 0 check (filas between 0 and 300),
  invalidas  integer not null default 0 check (invalidas >= 0),
  updated_at timestamptz not null default now()
);
-- ── 2 · Excesos de cuota, para Dirección: UNA fila por vendedor, día y tipo (contador, no bitácora de textos) ──
--   No guarda qué se buscó ni qué se devolvió. Crecimiento acotado: a lo más 3 filas por vendedor y día; al abrir un
--   día nuevo se retiran las de más de 90 días.
create table public.c4a_excesos (
  user_id   uuid not null,
  dia       date not null,
  tipo      text not null check (tipo in ('frecuencia', 'filas', 'invalidas')),
  intentos  integer not null default 1 check (intentos >= 1),
  primer_at timestamptz not null default now(),
  ultimo_at timestamptz not null default now(),
  primary key (user_id, dia, tipo)
);
create index idx_c4a_excesos_dia on public.c4a_excesos (dia);
-- ── 3 · Exclusiones manuales: cuentas que Dirección decide que NO salgan en la búsqueda (p. ej. nombre con datos de más
--        que la detección automática no reconoce). Sin interfaz todavía: la mantiene Dirección; nace vacía.
create table public.c4a_exclusiones (
  customer_id uuid primary key,
  motivo      text not null check (btrim(motivo) <> ''),
  creado_at   timestamptz not null default now(),
  creado_por  uuid
);
alter table public.c4a_cuota       enable row level security;
alter table public.c4a_excesos     enable row level security;
alter table public.c4a_exclusiones enable row level security;
revoke all on public.c4a_cuota, public.c4a_excesos, public.c4a_exclusiones from public, anon, authenticated, service_role;
-- Dirección CONSULTA (no escribe) el uso, los excesos y las exclusiones. Nadie más ve nada; nadie escribe por la API.
grant select on public.c4a_cuota, public.c4a_excesos, public.c4a_exclusiones to authenticated;
create policy c4a_cuota_select_direccion       on public.c4a_cuota       for select to authenticated using (public.auth_role() = 'admin');
create policy c4a_excesos_select_direccion     on public.c4a_excesos     for select to authenticated using (public.auth_role() = 'admin');
create policy c4a_exclusiones_select_direccion on public.c4a_exclusiones for select to authenticated using (public.auth_role() = 'admin');

-- ── 4 · Auxiliares (ninguna es invocable por usuarios) ────────────────────────────────────────────
-- Día comercial: el de Mazatlán, aunque el servidor esté en UTC.
create function public._c4a_dia_local(p_ts timestamptz) returns date
language sql stable set search_path = public as $fn$
  select (p_ts at time zone 'America/Mazatlan')::date
$fn$;

-- Nombre que puede mostrarse, o NULL si la cuenta NO debe salir en la búsqueda.
--   · NULL cuando el "nombre" parece una dirección postal: código postal (5 dígitos), "#" con número, palabra de
--     domicilio (calle, av, col, fracc, cp, int, ext, km, local, depto, lote, …) junto a algún dígito, o dos comas con
--     dígitos. Es conservadora: prefiere ocultar una cuenta legítima a mostrar un domicilio. No reconoce toda dirección
--     posible; para lo que se le escape está c4a_exclusiones.
--   · Un correo usado como nombre no se muestra ni en parte: 'Cliente sin nombre'.
--   · Un teléfono escrito dentro del nombre se sustituye por •••.
create function public._c4a_nombre_visible(p_nombre text) returns text
language sql immutable set search_path = public as $fn$
  with n as (select btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')) as x),
       l as (select x, lower(translate(x, 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛáàäâéèëêíìïîóòöôúùüû', 'aaaaeeeeiiiioooouuuuaaaaeeeeiiiioooouuuu')) as b from n)
  select case
    when x = '' then 'Cliente sin nombre'
    when position('@' in x) > 0 then 'Cliente sin nombre'
    when b ~ '(^|[^0-9])[0-9]{5}([^0-9]|$)'
      or b ~ '#\s*[0-9]'
      or (b ~ '[0-9]' and b ~ '\m(calle|av|ave|avenida|blvd|boulevard|bulevar|col|colonia|fracc|fraccionamiento|cp|num|no|int|ext|esq|esquina|carretera|km|local|piso|depto|departamento|manzana|mz|lote|lt|privada|priv|andador|calzada|calz|prolongacion|prol|edificio|edif|sn|s/n)\M')
      or b ~ '[0-9].*,.*,|,.*,.*[0-9]'
    then null
    else regexp_replace(x, '[0-9][0-9 ().+-]{5,}[0-9]', '•••', 'g')
  end from l
$fn$;

-- Anota un exceso (una fila por vendedor, día y tipo; suma intentos). Al abrir fila nueva retira lo de más de 90 días.
create function public._c4a_exceso(p_uid uuid, p_dia date, p_tipo text) returns void
language plpgsql volatile set search_path = public as $fn$
declare v_nueva boolean;
begin
  insert into public.c4a_excesos as e (user_id, dia, tipo) values (p_uid, p_dia, p_tipo)
  on conflict (user_id, dia, tipo) do update set intentos = e.intentos + 1, ultimo_at = clock_timestamp()
  returning (xmax = 0) into v_nueva;
  if v_nueva then
    delete from public.c4a_excesos where dia < p_dia - 90;
  end if;
end $fn$;
revoke all on function public._c4a_dia_local(timestamptz), public._c4a_nombre_visible(text), public._c4a_exceso(uuid, date, text) from public, anon, authenticated, service_role;

-- ── 5 · La búsqueda ───────────────────────────────────────────────────────────────────────────────
create function public.buscar_clientes_pos(q text, limite integer default 10)
returns table (customer_id uuid, nombre text, telefono_mascara text)
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_ventas  boolean;
  v_q       text;
  v_n       text;                 -- q normalizada: minúsculas, sin acentos
  v_pat     text;
  v_lim     int;
  v_tel     boolean := false;
  v_valida  boolean := true;
  v_ahora   timestamptz;
  v_hoy     date;
  v_marcas  timestamptz[];
  v_resto   int;
  v_dadas   int := 0;
  c         public.c4a_cuota;
  -- Mayúsculas acentuadas incluidas: lower() no las baja en una base con configuración regional "C".
  c_acentos constant text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_planos  constant text := 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';
begin
  -- 1 · Identidad: sesión de usuario con rol vigente de Dirección o Ventas. Es lo ÚNICO que se rechaza con excepción,
  --     y antes de mirar la búsqueda o cualquier dato.
  if v_uid is null then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  v_rol := public.auth_role();     -- '' sin perfil; lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  if v_rol not in ('admin', 'pos') then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  v_ventas := v_rol = 'pos';

  -- 2 · Entrada. Válida = por nombre (3+ caracteres, alguna letra, hasta 60) o EXACTAMENTE 4 dígitos. Todo lo demás
  --     (vacía, corta, larga, con "@", dígitos o signos que no sean 4 dígitos) es inválida, sin distinguir el motivo.
  if q is null or char_length(q) > 400 then
    v_valida := false;
  else
    v_q := btrim(regexp_replace(q, '\s+', ' ', 'g'));
    v_tel := v_q ~ '^[0-9]{4}$';
    v_n := translate(lower(v_q), c_acentos, c_planos);
    v_valida := char_length(v_q) <= 60 and position('@' in v_q) = 0
                and (v_tel or (v_n ~ '[a-z]' and char_length(replace(v_q, ' ', '')) >= 3));
  end if;
  v_lim := least(greatest(coalesce(limite, 10), 1), 10);

  -- 3 · Cuotas de Ventas. Nada de aquí lanza excepción: un rechazo responde vacío con estado HTTP 400 o 429 y la
  --     transacción SE CONFIRMA, para que el consumo y la anotación del exceso no se pierdan.
  if v_ventas then
    insert into public.c4a_cuota (user_id) values (v_uid) on conflict (user_id) do nothing;
    select * into c from public.c4a_cuota k where k.user_id = v_uid for update;     -- candado: una búsqueda a la vez por vendedor
    v_ahora := clock_timestamp();                                                 -- la hora, DESPUÉS de esperar el candado
    v_hoy := public._c4a_dia_local(v_ahora);
    if c.dia is distinct from v_hoy then
      c.dia := v_hoy; c.filas := 0; c.invalidas := 0;                              -- día comercial nuevo
    end if;
    -- 3a · Frecuencia: 20 búsquedas (válidas o no) en CUALQUIER tramo de 60 segundos.
    select coalesce(array_agg(m order by m), '{}') into v_marcas from unnest(c.marcas) m where m > v_ahora - interval '60 seconds';
    if cardinality(v_marcas) >= 20 then
      update public.c4a_cuota k set marcas = v_marcas, dia = c.dia, filas = c.filas, invalidas = c.invalidas, updated_at = v_ahora where k.user_id = v_uid;
      perform public._c4a_exceso(v_uid, v_hoy, 'frecuencia');
      perform set_config('response.status', '429', true);
      perform set_config('response.headers', '[{"X-Busqueda-Estado": "LIMITE_FRECUENCIA"}]', true);
      return;
    end if;
    v_marcas := v_marcas || v_ahora;
    -- 3b · Entradas inválidas: consumen frecuencia, no filas. Más de 60 en el día se tratan como abuso.
    if not v_valida then
      c.invalidas := c.invalidas + 1;
      update public.c4a_cuota k set marcas = v_marcas, dia = c.dia, filas = c.filas, invalidas = c.invalidas, updated_at = v_ahora where k.user_id = v_uid;
      if c.invalidas > 60 then
        perform public._c4a_exceso(v_uid, v_hoy, 'invalidas');
        perform set_config('response.status', '429', true);
        perform set_config('response.headers', '[{"X-Busqueda-Estado": "LIMITE_INVALIDAS"}]', true);
      else
        perform set_config('response.status', '400', true);
        perform set_config('response.headers', '[{"X-Busqueda-Estado": "BUSQUEDA_INVALIDA"}]', true);
      end if;
      return;
    end if;
    -- 3c · Presupuesto: 300 filas de clientes por día comercial. Nunca se devuelve más de lo que queda.
    v_resto := 300 - c.filas;
    if v_resto <= 0 then
      update public.c4a_cuota k set marcas = v_marcas, dia = c.dia, filas = c.filas, invalidas = c.invalidas, updated_at = v_ahora where k.user_id = v_uid;
      perform public._c4a_exceso(v_uid, v_hoy, 'filas');
      perform set_config('response.status', '429', true);
      perform set_config('response.headers', '[{"X-Busqueda-Estado": "LIMITE_FILAS"}]', true);
      return;
    end if;
    v_lim := least(v_lim, v_resto);
  elsif not v_valida then
    perform set_config('response.status', '400', true);
    perform set_config('response.headers', '[{"X-Busqueda-Estado": "BUSQUEDA_INVALIDA"}]', true);
    return;
  end if;

  -- 4 · Búsqueda. Solo tres columnas salen de aquí; el teléfono nunca completo. Una cuenta cuyo nombre no puede
  --     mostrarse (parece un domicilio) o que Dirección excluyó no aparece por ninguna vía. El nombre visible se calcula
  --     UNA vez por cuenta (bloque materializado) y todo lo demás —filtro, orden y salida— usa ese resultado.
  if v_tel then
    -- Últimos 4 dígitos EXACTOS, y solo de teléfonos con 8 dígitos o más (uno más corto quedaría revelado casi entero).
    return query
      with s as materialized (
        select c2.id, public._c4a_nombre_visible(c2.full_name) as v, right(regexp_replace(c2.phone, '[^0-9]', '', 'g'), 4) as u4
          from public.customers c2
         where c2.active
           and length(regexp_replace(coalesce(c2.phone, ''), '[^0-9]', '', 'g')) >= 8
           and right(regexp_replace(c2.phone, '[^0-9]', '', 'g'), 4) = v_q
           and not exists (select 1 from public.c4a_exclusiones x where x.customer_id = c2.id))
      select s.id, s.v, '••••' || s.u4
        from s
       where s.v is not null
       order by translate(lower(s.v), c_acentos, c_planos), s.id
       limit v_lim;
  else
    v_pat := replace(replace(replace(v_n, '\', '\\'), '%', '\%'), '_', '\_');
    return query
      with s as materialized (
        select c2.id, public._c4a_nombre_visible(c2.full_name) as v,
               case when length(regexp_replace(coalesce(c2.phone, ''), '[^0-9]', '', 'g')) >= 8
                    then '••••' || right(regexp_replace(c2.phone, '[^0-9]', '', 'g'), 4) end as m
          from public.customers c2
         where c2.active
           and position('@' in c2.full_name) = 0          -- un "nombre" que en realidad es un correo no se busca por texto
           and not exists (select 1 from public.c4a_exclusiones x where x.customer_id = c2.id)),
      t as materialized (select s.id, s.v, s.m, translate(lower(s.v), c_acentos, c_planos) as k from s where s.v is not null)
      -- se compara contra el nombre VISIBLE: un teléfono escrito dentro del nombre no se puede confirmar buscándolo
      select t.id, t.v, t.m
        from t
       where t.k like '%' || v_pat || '%' escape '\'
       order by (t.k like v_pat || '%' escape '\') desc, t.k, t.id
       limit v_lim;
  end if;
  get diagnostics v_dadas = row_count;

  -- 5 · Se descuenta EXACTAMENTE lo devuelto (0 si no hubo resultados).
  if v_ventas then
    update public.c4a_cuota k set marcas = v_marcas, dia = c.dia, filas = c.filas + v_dadas, invalidas = c.invalidas, updated_at = v_ahora where k.user_id = v_uid;
    if c.filas + v_dadas >= 300 then
      perform set_config('response.headers', '[{"X-Busqueda-Estado": "PRESUPUESTO_AGOTADO"}]', true);
    end if;
  end if;
end $fn$;
revoke all on function public.buscar_clientes_pos(text, integer) from public, anon, service_role;
grant execute on function public.buscar_clientes_pos(text, integer) to authenticated;
comment on function public.buscar_clientes_pos(text, integer) is
  'SEC-C4-A · Búsqueda mínima de clientes para Ventas y Dirección: customer_id, nombre y ••••últimos 4. Máx. 10 por búsqueda; Ventas: 20 búsquedas por minuto y 300 filas por día. Encontrar una cuenta NO autoriza su expediente.';

do $post$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A post: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() en su versión auditada y la zona horaria del día comercial.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then
    raise exception 'SEC-C4-A post: customers o auth_role() no son los auditados';
  end if;
  if ('2026-10-13 06:59:59+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-12'
     or ('2026-10-13 07:00:00+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-13' then
    raise exception 'SEC-C4-A post: la zona America/Mazatlan no se comporta como UTC-7 en este servidor';
  end if;
  -- Funciones: una firma cada una y existentes.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso')) <> 4
     or to_regprocedure('public.buscar_clientes_pos(text,integer)') is null or to_regprocedure('public._c4a_nombre_visible(text)') is null
     or to_regprocedure('public._c4a_dia_local(timestamptz)') is null or to_regprocedure('public._c4a_exceso(uuid,date,text)') is null
     or to_regclass('public.c4a_cuota') is null or to_regclass('public.c4a_excesos') is null or to_regclass('public.c4a_exclusiones') is null then
    raise exception 'SEC-C4-A post: los objetos de SEC-C4-A no quedaron como se diseñó';
  end if;
  -- Su versión, dueño, search_path fijo y permisos mínimos (solo la búsqueda es invocable, y solo por authenticated).
  if md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) <> '34c32c8b4dcb4bd0db32dc31afaa3b09'
     or md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) <> 'e50ea1b36459165de2981bc31b2cd53e'
     or md5(pg_get_functiondef('public._c4a_dia_local(timestamptz)'::regprocedure)) <> 'b75573ebe4e6c1df20af0a87e8a23aa3'
     or md5(pg_get_functiondef('public._c4a_exceso(uuid,date,text)'::regprocedure)) <> '12956d39d6b4e2b976966a24a2ce20ea'
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso')
                 and (p.proowner <> 'postgres'::regrole or p.proconfig is distinct from array['search_path=public']
                      or p.prosecdef is distinct from (p.proname = 'buscar_clientes_pos')
                      or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
                      or has_function_privilege('authenticated', p.oid, 'execute') is distinct from (p.proname = 'buscar_clientes_pos')
                      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))) then
    raise exception 'SEC-C4-A post: las funciones de SEC-C4-A no quedaron como se diseñó';
  end if;
  -- Tablas: dueño, RLS activa, authenticated SOLO lee (y solo Dirección por política); anon y service_role nada.
  if exists (select 1 from pg_class c where c.oid in ('public.c4a_cuota'::regclass, 'public.c4a_excesos'::regclass, 'public.c4a_exclusiones'::regclass)
              and (c.relowner <> 'postgres'::regrole or not c.relrowsecurity
                   or not has_table_privilege('authenticated', c.oid, 'select')
                   or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate')
                   or has_table_privilege('anon', c.oid, 'select') or has_table_privilege('service_role', c.oid, 'select')))
     or (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname)
           from pg_policies where schemaname = 'public' and tablename like 'c4a\_%')
        is distinct from 'c4a_cuota.c4a_cuota_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7,c4a_excesos.c4a_excesos_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7,c4a_exclusiones.c4a_exclusiones_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7' then
    raise exception 'SEC-C4-A post: las tablas de SEC-C4-A no quedaron como se diseñó';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
