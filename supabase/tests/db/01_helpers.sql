-- ============================================================================
-- Helpers de pruebas de BD (W1 · RC-35). Solo existen en el cluster desechable.
--   Aserciones:  tests.ok / tests.eq / tests.throws / tests.lives
--   Identidad:   tests.user(rol) · tests.act_as(uid) · tests.act_as_anon() · tests.act_as_service() · tests.act_as_owner()
--   Fixtures:    tests.product() · tests.stock() · tests.order() · tests.packed_order() · tests.op()
-- Cada archivo de prueba corre en BEGIN … ROLLBACK (aislado); la concurrencia
-- usa sesiones reales con COMMIT (concurrency/*.sh).
-- ============================================================================
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- aserciones
create or replace function tests.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end $$;

create or replace function tests.eq(p_got anycompatible, p_want anycompatible, p_name text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL: % (obtenido %, esperado %)', p_name, p_got, p_want; end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Ejecuta p_sql y exige que falle con un mensaje que contenga p_pattern.
create or replace function tests.throws(p_sql text, p_pattern text, p_name text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    if position(lower(p_pattern) in lower(v_msg)) > 0 then
      raise notice 'PASS: % [%]', p_name, left(v_msg, 90);
      return;
    end if;
    raise exception 'FAIL: % — error inesperado: %', p_name, v_msg;
  end;
  raise exception 'FAIL: % — no falló (se esperaba "%")', p_name, p_pattern;
end $$;

create or replace function tests.throws_any(p_sql text, p_patterns text[], p_name text) returns void language plpgsql as $$
declare v_msg text; p text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    foreach p in array p_patterns loop
      if position(lower(p) in lower(v_msg)) > 0 then
        raise notice 'PASS: % [%]', p_name, left(v_msg, 90);
        return;
      end if;
    end loop;
    raise exception 'FAIL: % — error inesperado: %', p_name, v_msg;
  end;
  raise exception 'FAIL: % — no falló (se esperaba uno de %)', p_name, p_patterns;
end $$;

-- Aserción FUERTE de no-autoridad: intenta la escritura y exige que el valor NO cambie,
-- sin importar si el bloqueo vino de un trigger (excepción) o de RLS (0 filas afectadas).
create or replace function tests.sin_efecto(p_sql text, p_probe text, p_expected text, p_name text)
returns void language plpgsql as $$
declare v_got text; v_claims text; v_role text;
begin
  begin execute p_sql; exception when others then null; end;
  -- El sondeo se hace como DUEÑO: si se leyera con el rol impersonado, la RLS de lectura
  -- devolvería NULL y se confundiría "no puedo verlo" con "lo cambié".
  v_claims := current_setting('request.jwt.claims', true);
  v_role   := current_setting('role', true);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute p_probe into v_got;
  perform set_config('role', coalesce(nullif(v_role, ''), 'none'), true);
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  if v_got is distinct from p_expected then
    raise exception 'FAIL: % — el valor CAMBIÓ (% → %)', p_name, p_expected, coalesce(v_got, '<NULL>');
  end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Contexto compartido entre sesiones concurrentes (ids de fixtures confirmados).
create table if not exists tests.ctx (key text primary key, val uuid not null);
grant select on tests.ctx to anon, authenticated, service_role;
create or replace function tests.id(p_key text) returns uuid language sql stable as $$ select val from tests.ctx where key = p_key $$;

create or replace function tests.lives(p_sql text, p_name text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS: %', p_name;
end $$;

-- ------------------------------------------------------------------ identidad
-- Crea un usuario de auth + perfil con el rol indicado (vía el trigger real handle_new_user).
create or replace function tests.user(p_role text, p_email text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_claims text := current_setting('request.jwt.claims', true);
begin
  insert into auth.users (id, email) values (v_id, coalesce(p_email, p_role || '-' || left(v_id::text, 8) || '@test.local'));
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.profiles set role_id = p_role, verified = true where id = v_id;
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v_id;
end $$;

create or replace function tests.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function tests.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function tests.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create or replace function tests.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ------------------------------------------------------------------- fixtures
create or replace function tests.op() returns uuid language sql as $$ select gen_random_uuid() $$;

create or replace function tests.product(p_price numeric default 100, p_sku text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.products (sku, name, price, active, sellable)
  values (coalesce(p_sku, 'T-' || left(gen_random_uuid()::text, 8)), 'Producto de prueba', p_price, true, true)
  returning id into v_id;
  return v_id;
end $$;

-- Stock legítimo: entra por el comando real (sin_orden, admin) → lote + recepción + kardex.
create or replace function tests.stock(p_product uuid, p_code text, p_qty int,
                                       p_expiry date default (current_date + 365)) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_claims text := current_setting('request.jwt.claims', true); v_res jsonb;
begin
  select id into v_admin from public.profiles where role_id = 'admin' and email like 'fixture-admin%' limit 1;
  if v_admin is null then v_admin := tests.user('admin', 'fixture-admin@test.local'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.recibir_lote(gen_random_uuid(), p_product, p_code, p_expiry, p_qty, null, 'sin_orden', null, 'fixture', null);
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return (v_res ->> 'lot_id')::uuid;
end $$;

-- Actor admin reutilizable para los fixtures.
create or replace function tests.fixture_admin() returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.profiles where role_id = 'admin' and email like 'fixture-admin%' limit 1;
  if v is null then v := tests.user('admin', 'fixture-admin@test.local'); end if;
  return v;
end $$;

-- W2: el dinero de un fixture entra por el COMANDO real (asiento en el libro).
create or replace function tests.cobrar(p_order uuid, p_amount numeric default null, p_method text default 'transferencia')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_admin uuid := tests.fixture_admin(); v_claims text := current_setting('request.jwt.claims', true);
        v_op uuid := gen_random_uuid(); v_monto numeric;
begin
  select coalesce(p_amount, total) into v_monto from public.orders where id = p_order;
  if coalesce(v_monto, 0) <= 0 then return null; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.registrar_cobro(v_op, p_order, p_method, v_monto);
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v_op;
end $$;

-- W2: el doctor DECLARA un pago (queda en revisión, no mueve dinero).
create or replace function tests.reportar(p_order uuid, p_amount numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_claims text := current_setting('request.jwt.claims', true); v_op uuid := gen_random_uuid(); v_monto numeric;
begin
  select doctor_id, coalesce(p_amount, total) into v_doc, v_monto from public.orders where id = p_order;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform public.reportar_pago(v_op, p_order, 'transferencia', v_monto, 'REF-FIXTURE');
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v_op;
end $$;

-- W2: crédito autorizado (libera para surtir SIN tocar payment_status ni status).
create or replace function tests.credito(p_order uuid, p_dias int default 30)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_admin uuid := tests.fixture_admin(); v_claims text := current_setting('request.jwt.claims', true);
        v_op uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.autorizar_credito(v_op, p_order, public.hoy_local() + p_dias, 'fixture');
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v_op;
end $$;

-- Pedido en un estado inicial dado (inserción directa como dueño; las guardas son BEFORE UPDATE).
-- W2: si el fixture lo pide 'paid', el cobro entra por el comando real → asiento en el libro.
-- p_items: [{"product_id": ..., "qty": n, "unit_price": x}]
create or replace function tests.order(p_doctor uuid, p_status text, p_items jsonb,
                                       p_payment_status text default 'pending', p_meta jsonb default null,
                                       p_folio text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders (id, external_ref, doctor_id, total, status, payment_method, payment_status, shipping_meta)
  values (v_id, coalesce(p_folio, 'T' || left(v_id::text, 6)), p_doctor,
          (select coalesce(sum((i->>'qty')::int * coalesce((i->>'unit_price')::numeric, 100)), 0) from jsonb_array_elements(p_items) i),
          p_status, 'transferencia', case when p_payment_status = 'paid' then 'pending' else p_payment_status end, p_meta);
  insert into public.order_items (order_id, product_id, qty, unit_price)
  select v_id, (i->>'product_id')::uuid, (i->>'qty')::int, coalesce((i->>'unit_price')::numeric, 100)
    from jsonb_array_elements(p_items) i;
  if p_payment_status = 'paid' then perform tests.cobrar(v_id); end if;
  return v_id;
end $$;

-- Asignaciones FEFO para un pedido (como el planificador del cliente): reparte cada
-- renglón entre lotes vigentes del producto, primero el que caduca antes.
create or replace function tests.alloc(p_order uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; l record; v_need int; v_take int; v_out jsonb := '[]'::jsonb;
begin
  for it in select id, product_id, qty from public.order_items where order_id = p_order order by id loop
    v_need := it.qty;
    for l in select id, quantity from public.lots
              where product_id = it.product_id and quantity > 0 and not public.lote_caducado(expiry_date)
              order by expiry_date, id loop
      exit when v_need <= 0;
      v_take := least(v_need, l.quantity);
      v_out := v_out || jsonb_build_array(jsonb_build_object('order_item_id', it.id, 'lot_id', l.id, 'qty', v_take));
      v_need := v_need - v_take;
    end loop;
  end loop;
  return v_out;
end $$;

-- Pedido pagado y surtido por el comando real (queda 'packed' con salidas en kardex).
create or replace function tests.packed_order(p_doctor uuid, p_items jsonb, p_payment_status text default 'paid')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_o uuid; v_wh uuid; v_claims text := current_setting('request.jwt.claims', true);
begin
  v_o := tests.order(p_doctor, 'paid', p_items, p_payment_status);
  select id into v_wh from public.profiles where role_id = 'warehouse' and email like 'fixture-wh%' limit 1;
  if v_wh is null then v_wh := tests.user('warehouse', 'fixture-wh@test.local'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  perform public.surtir_pedido(gen_random_uuid(), v_o, tests.alloc(v_o));
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return v_o;
end $$;

-- Lleva un pedido a otro estado sin pasar por guardas (solo para preparar escenarios).
create or replace function tests.force_status(p_order uuid, p_status text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.trusted', 'on', true);
  update public.orders set status = p_status where id = p_order;
  perform set_config('app.trusted', 'off', true);
end $$;

-- Existencia = Σ kardex (I-04) para un lote.
create or replace function tests.kardex_ok(p_lot uuid) returns boolean language sql security definer set search_path = public as $$
  select l.quantity = coalesce((select sum(change) from public.inventory_movements m where m.lot_id = l.id), 0)
    from public.lots l where l.id = p_lot
$$;
create or replace function tests.qty(p_lot uuid) returns int language sql security definer set search_path = public as $$
  select quantity from public.lots where id = p_lot
$$;
-- Conciliación completa como Dirección: nº de hallazgos de severidad 'error'.
create or replace function tests.conciliacion_errores() returns int language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_claims text := current_setting('request.jwt.claims', true); n int;
begin
  select id into v_admin from public.profiles where role_id = 'admin' and email like 'fixture-admin%' limit 1;
  if v_admin is null then v_admin := tests.user('admin', 'fixture-admin@test.local'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.conciliar_inventario() where severidad = 'error';
  perform set_config('request.jwt.claims', coalesce(nullif(v_claims, ''), '{}'), true);
  return n;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
