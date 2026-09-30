-- W2-C · EL LIBRO DE CUSTODIA ES APPEND-ONLY. Igual que el kardex de W1 y el libro de
-- dinero de W2: nada se edita ni se borra; se corrige con una línea nueva. Y la
-- aritmética de "en poder" está fijada por constraint, no por convención.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_pos uuid := tests.user('pos');
  v_p uuid := tests.product(100); v_lot uuid; v_cus uuid; v_line uuid;
begin
  v_lot := tests.stock(v_p, 'W2C-A1', 10);
  v_cus := tests.custodia('vendedor', v_pos);
  perform tests.entregar(v_cus, v_lot, 4);
  perform tests.act_as_owner();
  select id into v_line from public.custody_lines where custody_id = v_cus limit 1;

  -- ── Inmutabilidad (incluso para el dueño de la base) ────────────────────────
  perform tests.throws(format('update public.custody_lines set qty = 99 where id = %L', v_line),
    'LEDGER_APPEND_ONLY', 'una línea del libro no se edita');
  perform tests.throws(format('delete from public.custody_lines where id = %L', v_line),
    'LEDGER_APPEND_ONLY', 'una línea del libro no se borra');
  -- El TRUNCATE no se puede PROBAR dentro de esta transacción (tiene verificaciones de
  -- llave diferidas pendientes), así que se verifica que la guarda esté instalada.
  perform tests.ok(exists (select 1 from pg_trigger t
                            where t.tgrelid = 'public.custody_lines'::regclass
                              and t.tgname = 'trg_custody_lines_no_truncate'),
    'el libro tiene guarda contra TRUNCATE');
  perform tests.throws('update public.custody_operations set result = ''{}''::jsonb',
    'LEDGER_APPEND_ONLY', 'el registro de operaciones no se edita');
  perform tests.throws(format('update public.custodies set status = ''cerrada'' where id = %L', v_cus),
    'CUSTODIA_SOLO_POR_COMANDO', 'la custodia no se cierra a mano, ni desde la base');
  perform tests.throws(format('delete from public.custodies where id = %L', v_cus),
    'CUSTODIA_NO_SE_BORRA', 'una custodia no se elimina: se cierra con motivo');

  -- ── La aritmética del saldo está fijada por constraint ──────────────────────
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'entrega', %L, %L, 5, -5)$q$, v_cus, v_p, v_lot),
    'ck_custody_line_held_delta', 'una entrega no puede declarar que RESTA existencia');
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'venta', %L, %L, 5, 5)$q$, v_cus, v_p, v_lot),
    'ck_custody_line_held_delta', 'una venta no puede declarar que SUMA existencia');
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'entrega', %L, %L, 0, 0)$q$, v_cus, v_p, v_lot),
    'ck_custody_line_qty', 'no hay líneas de cantidad cero');
  -- (el orden en que Postgres evalúa las constraints no está garantizado: cualquiera de
  --  las dos rechaza un tipo inventado)
  perform tests.throws_any(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'regalo', %L, %L, 1, -1)$q$, v_cus, v_p, v_lot),
    array['ck_custody_line_kind', 'ck_custody_line_held_delta'], 'vocabulario cerrado de tipos de línea');

  -- ── Una venta SIEMPRE se liga a su pedido y su precio; una pérdida a su baja ─
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'venta', %L, %L, 1, -1)$q$, v_cus, v_p, v_lot),
    'ck_custody_line_venta', 'no existe una venta de custodia sin pedido, renglón y precio');
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta, motivo)
      values (gen_random_uuid(), %L, 'merma', %L, %L, 1, -1, 'roto')$q$, v_cus, v_p, v_lot),
    'ck_custody_line_perdida', 'no existe una pérdida sin su baja real de inventario');
  perform tests.throws(format($q$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta, reversal_of)
      values (gen_random_uuid(), %L, 'ajuste', %L, %L, 1, 1, null)$q$, v_cus, v_p, v_lot),
    'ck_custody_line_held_delta', 'un ajuste SIEMPRE compensa una línea concreta');

  -- ── El saldo es la SUMA del libro, no un contador ────────────────────────────
  perform tests.eq(public.custody_held(v_lot), 4, 'en custodia = Σ held_delta del libro');
  perform tests.eq((select sum(held_delta)::int from public.custody_lines where lot_id = v_lot), 4,
    'no hay otra fuente del saldo que el libro mismo');
  perform tests.eq(tests.disp(v_lot), 6, 'disponible = 10 propias − 4 en custodia');

  -- ── Escape administrativo controlado (igual que W1/W2): solo con purge ──────
  perform set_config('renovacell.purge', 'on', true);
  perform tests.lives(format('delete from public.custody_lines where id = %L', v_line),
    'la purga administrativa deliberada sí puede limpiar un set de pruebas');
  perform set_config('renovacell.purge', 'off', true);
end
$t$;
set constraints all immediate;
rollback;
