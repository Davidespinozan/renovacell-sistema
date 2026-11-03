-- IMPORTAR-LOTE-FECHA (20270319) · la carga inicial solo acepta AAAA-MM-DD: "06/07/2027" ya no entra como 7 de junio.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); p uuid; ok boolean; r jsonb;
begin
  perform tests.act_as_owner();
  p := tests.product(100); update public.products set sku = 'IMP-FECHA-1' where id = p;
  perform tests.act_as(v_admin);
  begin perform public.importar_lote(gen_random_uuid(), 'IMP-FECHA-1', 'L-AMB', '06/07/2027', 5); ok := false; exception when others then ok := sqlerrm like 'CADUCIDAD_INVALIDA%'; end;
  perform tests.ok(ok, '1 · día/mes ambiguo: se rechaza (la pantalla lo traduce antes)');
  begin perform public.importar_lote(gen_random_uuid(), 'IMP-FECHA-1', 'L-INEX', '2027-02-31', 5); ok := false; exception when others then ok := sqlerrm like 'CADUCIDAD_INVALIDA%'; end;
  perform tests.ok(ok, '2 · fecha inexistente: se rechaza');
  r := public.importar_lote(gen_random_uuid(), 'IMP-FECHA-1', 'L-OK', '2027-07-06', 5);
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'result' = 'created' and (select expiry_date = date '2027-07-06' and quantity = 5 from public.lots where product_id = p and lot_code = 'L-OK'), '3 · AAAA-MM-DD entra con la fecha exacta');
end $t$;
rollback;
