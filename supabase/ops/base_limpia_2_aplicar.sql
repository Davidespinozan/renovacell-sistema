-- ============================================================================
-- BASE LIMPIA 2 (2 nov 2026) — SCRIPT OPERATIVO (NO es una migración). Autorizado por David:
--   "todas las personas que están en el sistema ya con acceso son fake, las ventas también" · "todas se borran".
--
-- Qué borra (todo en UNA transacción; ante cualquier error, nada):
--   · TODOS los pedidos (todos son de prueba) y lo que cuelga de ellos (renglones, cobros, kardex, envíos, CFDI…).
--   · El lote de prueba 1231231232 y sus movimientos (el inventario real aún no se carga).
--   · Las 9 cuentas de doctor (auth.users → profiles) y lo que cuelga de ellas: sus conversaciones del portal,
--     carritos, cartera, avisos, push, intentos del examen de la IA, etc.
--   · Las 6 fichas de cliente creadas desde el portal por esas cuentas.
-- Qué NO toca: personal, fichas de Odoo (JEHIELI se queda: solo pierde la cuenta de prueba), catálogo, precios,
--   WhatsApp de clientes (aparte), configuración. Historial que se conserva con el autor en blanco (no se borra):
--   bitácora (audit_logs), eventos de cliente, visitantes adoptados.
--
-- Todo lo borrado se copia antes a purga_20261102.filas (esquema sin acceso desde la API).
-- Uso: psql / Management API con este archivo. Las líneas finales deciden: SIMULACRO (rollback) o APLICAR (commit).
-- ============================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';

create schema if not exists purga_20261102;
revoke all on schema purga_20261102 from public, anon, authenticated;
create table if not exists purga_20261102.filas (id bigserial primary key, tabla text not null, fila jsonb not null, archivado_at timestamptz not null default now());
create table if not exists purga_20261102.conteo (tabla text primary key, borradas bigint not null default 0, en_blanco bigint not null default 0);

-- Escapes administrativos existentes (los guardas de libros, fiscal, pedidos y conversaciones los respetan).
select set_config('renovacell.purge', 'on', true), set_config('app.trusted', 'on', true), set_config('app.cc_purga', 'on', true);
-- Hay ciclos de llaves (p. ej. cobro ↔ comprobante) que no se pueden soltar fila por fila. Dentro de ESTA transacción se
-- apagan los disparadores de llaves y guardas: el borrado recursivo de abajo enumera TODO lo que cuelga de cada fila
-- (también lo que antes borraba la base en cascada) y la verificación final comprueba que no quedó nada huérfano.
set local session_replication_role = replica;

-- Raíces exactas
create temp table r_users on commit drop as select id from public.profiles where role_id = 'doctor';
do $c$ begin
  if (select count(*) from r_users) <> 9 then raise exception 'BASE_LIMPIA_ABORT: se esperaban 9 cuentas de doctor, hay %', (select count(*) from r_users); end if;
  if (select count(*) from public.lots) <> 1 or not exists (select 1 from public.lots where lot_code = '1231231232') then raise exception 'BASE_LIMPIA_ABORT: el inventario cambió (ya no es solo el lote de prueba)'; end if;
end $c$;

-- Columnas que se dejan EN BLANCO en vez de borrar la fila (historia real o datos que se conservan).
create temp table r_blanco (tabla regclass, col name) on commit drop;
insert into r_blanco values ('public.customers', 'profile_id'), ('public.cc_visitors', 'adopted_profile_id'), ('public.cc_visitors', 'pending_profile_id'),
  ('public.audit_logs', 'actor'), ('public.customer_events', 'actor_profile_id'), ('public.entrega_horarios', 'created_by'), ('public.notifications', 'created_by');

-- Referencias que, aunque la base las deje en blanco, se BORRAN: un aviso de una conversación de prueba no sirve.
create temp table r_borrar (tabla regclass, col name) on commit drop;
insert into r_borrar values ('public.notifications', 'conversation_id');

-- Borrado recursivo con archivo: antes de borrar filas de una tabla, resuelve (archiva y borra, o deja en blanco)
-- todo lo que las referencia. Ciclos: una tabla no se vuelve a abrir dentro de su propia rama.
create function pg_temp.purgar(p_tabla regclass, p_cond text, p_ruta regclass[] default '{}') returns void language plpgsql as $f$
declare fk record; v_sub text; n bigint;
begin
  for fk in
    select c.conrelid::regclass t, a.attname col, af.attname refcol, c.confdeltype del
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = p_tabla and array_length(c.conkey, 1) = 1
  loop
    v_sub := format('%I in (select %I from %s where %s)', fk.col, fk.refcol, p_tabla, p_cond);
    if (exists (select 1 from r_blanco b where b.tabla = fk.t and b.col = fk.col) or fk.del = 'n')
       and not exists (select 1 from r_borrar b where b.tabla = fk.t and b.col = fk.col) then
      -- Se deja en blanco; si la fila no admite quedar sin esa referencia (regla de la tabla), es que depende del
      -- dato de prueba: entonces se borra también (con su archivo).
      begin
        execute format('update %s set %I = null where %s', fk.t, fk.col, v_sub);
        get diagnostics n = row_count;
        if n > 0 then insert into purga_20261102.conteo as k (tabla, en_blanco) values (fk.t::text || '.' || fk.col, n) on conflict (tabla) do update set en_blanco = k.en_blanco + excluded.en_blanco; end if;
      exception when check_violation or not_null_violation then
        if fk.t = p_tabla or fk.t = any (p_ruta) then raise; end if;
        perform pg_temp.purgar(fk.t, v_sub, p_ruta || p_tabla);
      end;
    elsif fk.t = p_tabla or fk.t = any (p_ruta) then
      null;   -- autorreferencia / ciclo: esas filas ya caen en un nivel de arriba de esta misma rama
    else
      perform pg_temp.purgar(fk.t, v_sub, p_ruta || p_tabla);
    end if;
  end loop;
  execute format('insert into purga_20261102.filas (tabla, fila) select %L, to_jsonb(t) from %s t where %s', p_tabla::text, p_tabla, p_cond);
  execute format('delete from %s where %s', p_tabla, p_cond);
  get diagnostics n = row_count;
  if n > 0 then insert into purga_20261102.conteo as k (tabla, borradas) values (p_tabla::text, n) on conflict (tabla) do update set borradas = k.borradas + excluded.borradas; end if;
end $f$;

-- Huérfanos que YA existían antes (p. ej. 2 identidades de jul 2026): la verificación final solo compara contra esto.
create temp table r_huerfanos_antes (llave text primary key, n bigint) on commit drop;
create function pg_temp.huerfanos() returns table (llave text, n bigint) language plpgsql as $o$
declare fk record; c bigint;
begin
  for fk in select c.conrelid::regclass t, a.attname col, c.confrelid::regclass r, af.attname refcol
              from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
             where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
  loop
    execute format('select count(*) from %s x where x.%I is not null and not exists (select 1 from %s y where y.%I = x.%I)', fk.t, fk.col, fk.r, fk.refcol, fk.col) into c;
    if c > 0 then llave := fk.t::text || '.' || fk.col || ' → ' || fk.r::text; n := c; return next; end if;
  end loop;
end $o$;
insert into r_huerfanos_antes select * from pg_temp.huerfanos();

select pg_temp.purgar('public.orders', 'true');
select pg_temp.purgar('public.lots', $$lot_code = '1231231232'$$);
select pg_temp.purgar('public.inventory_movements', 'true');
select pg_temp.purgar('public.customers', 'source = ''portal'' and profile_id in (select id from r_users)');
select pg_temp.purgar('public.cc_conversations', 'profile_id in (select id from r_users)');
select pg_temp.purgar('auth.users', 'id in (select id from r_users)');

-- Verificación
do $v$ begin
  if exists (select 1 from public.orders) or exists (select 1 from public.lots) or exists (select 1 from public.payment_entries) then raise exception 'BASE_LIMPIA_ABORT: quedaron pedidos, lotes o cobros'; end if;
  if exists (select 1 from public.profiles where role_id = 'doctor') then raise exception 'BASE_LIMPIA_ABORT: quedaron cuentas de doctor'; end if;
  if not exists (select 1 from public.customers where email = 'jehielisalazar@hotmail.com' and profile_id is null) then raise exception 'BASE_LIMPIA_ABORT: la ficha de Odoo de JEHIELI debía conservarse'; end if;
  if (select count(*) from public.profiles where role_id <> 'doctor') <> 11 then raise exception 'BASE_LIMPIA_ABORT: el personal cambió'; end if;
end $v$;
-- Sin huérfanos NUEVOS: ninguna llave quedó apuntando a una fila borrada (las llaves se apagaron arriba).
do $h$ declare x record;
begin
  for x in select h.llave, h.n, coalesce(a.n, 0) antes from pg_temp.huerfanos() h left join r_huerfanos_antes a using (llave) where h.n > coalesce(a.n, 0) loop
    raise exception 'BASE_LIMPIA_ABORT: % filas huérfanas nuevas en % (antes %)', x.n - x.antes, x.llave, x.antes;
  end loop;
end $h$;

select tabla, borradas, en_blanco from purga_20261102.conteo order by borradas desc, tabla;
-- ── APLICAR (autorizado por David, 2 nov 2026). Se niega a correr dos veces: ya no habría 9 cuentas de doctor. ──
commit;
