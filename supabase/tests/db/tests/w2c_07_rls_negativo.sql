-- W2-C · RLS NEGATIVA. La custodia se escribe SOLO por comando. Nadie —ni el tenedor,
-- ni Almacén, ni Dirección— puede tocar su saldo por la API. Y el tenedor externo no
-- depende de un correo mutable.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_otro uuid := tests.user('pos', 'ajeno@test.local'); v_doc uuid := tests.user('doctor');
  v_bill uuid := tests.user('billing'); v_p uuid := tests.product(100);
  v_lot uuid; v_cus uuid; v_cus2 uuid; v_line uuid; v_role text; v_uid uuid; v_cust_ext uuid;
begin
  v_lot := tests.stock(v_p, 'W2C-R1', 10);
  v_cus := tests.custodia('vendedor', v_pos);
  v_cus2 := tests.custodia('vendedor', v_otro);
  perform tests.entregar(v_cus, v_lot, 6);
  perform tests.act_as_owner();
  select id into v_line from public.custody_lines where custody_id = v_cus limit 1;

  -- ── 15) NADIE escribe el libro ni la custodia por la API ────────────────────
  foreach v_role in array array['admin','warehouse','pos','doctor','billing'] loop
    v_uid := case v_role when 'admin' then v_admin when 'warehouse' then v_wh when 'pos' then v_pos
                         when 'doctor' then v_doc else v_bill end;
    perform tests.act_as(v_uid);
    perform tests.throws(format($s$insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta)
      values (gen_random_uuid(), %L, 'entrega', %L, %L, 99, 99)$s$, v_cus, v_p, v_lot),
      'permission denied', v_role || ': 15 · no inserta líneas de custodia');
    perform tests.throws(format('update public.custody_lines set qty = 1 where id = %L', v_line),
      'permission denied', v_role || ': no edita el libro de custodia');
    perform tests.throws('delete from public.custody_lines', 'permission denied', v_role || ': no borra el libro');
    perform tests.throws(format($s$insert into public.custodies (id, kind, holder_kind, holder_user_id)
      values (gen_random_uuid(), 'vendedor', 'staff', %L)$s$, v_uid),
      'permission denied', v_role || ': no crea custodias a mano');
    perform tests.throws(format('update public.custodies set status = ''cerrada'' where id = %L', v_cus),
      'permission denied', v_role || ': no cierra una custodia a mano');
    perform tests.throws('delete from public.custodies', 'permission denied', v_role || ': no borra custodias');
    perform tests.throws('insert into public.custody_operations (op_id, kind, request) values (gen_random_uuid(), ''entrega'', ''{}''::jsonb)',
      'permission denied', v_role || ': no fabrica operaciones de custodia');
    -- helpers internos fuera de alcance
    perform tests.throws(format('select public._w2c_perdida(%L, ''merma'', %L, 1, ''x'', null, gen_random_uuid())', v_cus, v_lot),
      'permission denied', v_role || ': no invoca el helper de pérdida');
    perform tests.throws('select public._w2c_op_begin(gen_random_uuid(), ''entrega'', ''{}''::jsonb)',
      'permission denied', v_role || ': no toca el registro de idempotencia');
    perform tests.throws(format('select public.custody_held_en(%L, %L)', v_cus, v_lot),
      'permission denied', v_role || ': el saldo por custodia se pide por estado_custodia, no por el helper');
    perform tests.act_as_owner();
  end loop;

  -- ── El legacy quedó INERTE (C4) ─────────────────────────────────────────────
  foreach v_role in array array['admin','warehouse','pos','doctor'] loop
    v_uid := case v_role when 'admin' then v_admin when 'warehouse' then v_wh when 'pos' then v_pos else v_doc end;
    perform tests.act_as(v_uid);
    perform tests.throws('insert into public.events (name) values (''Fantasma'')',
      'permission denied', v_role || ': no crea eventos legacy');
    perform tests.throws('update public.events set items = ''[]''::jsonb', 'permission denied',
      v_role || ': no reescribe el contador JSON legacy');
    perform tests.throws($s$insert into public.consignment_stock (vendor, product_id, assigned, sold)
      values ('yo@test.local', null, 999, 0)$s$, 'permission denied',
      v_role || ': no fabrica un saldo de consignación legacy');
    perform tests.throws('update public.consignment_stock set assigned = 999', 'permission denied',
      v_role || ': no reescribe su propio saldo legacy');
    perform tests.throws('select public.event_sell(gen_random_uuid(), ''[]''::jsonb)',
      'permission denied', v_role || ': event_sell revocado');
    perform tests.act_as_owner();
  end loop;

  -- ── Visibilidad: el tenedor ve la suya, no la ajena ─────────────────────────
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*)::int from public.custodies where id = v_cus), 1, 'el tenedor ve su custodia');
  perform tests.eq((select count(*)::int from public.custodies where id = v_cus2), 0, 'no ve la custodia de otro vendedor');
  perform tests.eq((select count(*)::int from public.custody_lines where custody_id = v_cus2), 0,
    'no ve el libro de otro vendedor');
  perform tests.throws(format('select public.estado_custodia(%L)', v_cus2), 'NO_AUTORIZADO',
    'no consulta el estado de una custodia ajena');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.custodies), 0, 'un doctor no ve ninguna custodia');
  perform tests.eq((select count(*)::int from public.custody_lines), 0, 'ni el libro');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.custodies where id in (v_cus, v_cus2)), 2,
    'Almacén ve todas: es quien entrega y recibe');
  perform tests.act_as(v_pos);
  perform tests.throws('select * from public.conciliar_custodia()', 'NO_AUTORIZADO',
    'la conciliación de custodia es de Dirección');

  -- ── 16) El tenedor externo NO depende de un correo mutable ──────────────────
  perform tests.act_as_owner();
  insert into public.customers (full_name, email, active) values ('Clínica Sur', 'antes@clinica.mx', true)
    returning id into v_cust_ext;
  perform tests.act_as(v_admin);
  perform public.abrir_custodia(tests.op(), 'vendedor', 'tercero', null, v_cust_ext);
  perform tests.act_as_owner();
  -- el correo cambia: la custodia sigue apuntando a la MISMA identidad
  update public.customers set email = 'despues@otra.mx' where id = v_cust_ext;
  perform tests.eq((select count(*)::int from public.custodies where holder_customer_id = v_cust_ext), 1,
    '16: cambiar el correo del tercero no huerfaniza su custodia (la identidad es el id)');
  perform tests.ok((select holder_user_id is null from public.custodies where holder_customer_id = v_cust_ext),
    '16: un externo NO necesita usuario interno fingido');
  perform tests.eq((select count(*)::int from information_schema.columns
                     where table_schema = 'public' and table_name = 'custodies'
                       and column_name in ('vendor','email','holder_email')), 0,
    '16: la custodia no tiene ninguna columna de correo ni de texto libre como identidad');
end
$t$;
set constraints all immediate;
rollback;
