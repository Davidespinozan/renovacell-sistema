-- W5 · KPIs DE CABECERA. Escenario adversarial construido con los COMANDOS reales
-- (recepción, surtido, cobro, crédito, devolución, reembolso, cancelación, merma).
--
-- Periodos: A = hace dos meses · B = el mes pasado · C = el mes en curso.
-- Todos los movimientos de almacén ocurren HOY (mes C): el costo se empareja con el
-- pedido, no con la fecha en que se movió el almacén.
--
--   pedido  mes  total  qué pone a prueba
--   O1      A    200    levantado a las 23:30 del último día de A; pagado en B
--   O2      A    300    dos pagos parciales en A (100 + 50); el resto a crédito
--   O3      A    100    pagado en A; devuelto y reembolsado en B
--   O4      A    100    pagado en A y luego CANCELADO (no es venta; el dinero sí entró)
--   O5      A    200    crédito autorizado, sin un solo cobro
--   O6      A    200    producto SIN costo conocido
--   O7      A    300    mezcla: 1 pieza con costo + 1 pieza sin costo
--   O8      A    400    cobrado y SIN surtir (su costo aún no existe)
--   O9      B    100    levantado en el primer instante de B
--   O10     A    —      borrador (no es venta)
--   OP      2025 100    folio de mostrador con saldo (queda fuera de "por cobrar")
begin;
do $t$
declare
  -- GOLDEN: lo que la capa TypeScript (data/kpis.ts) debe dar EXACTAMENTE con el mismo
  -- escenario. Lo lee apps/web/src/data/kpis.paridad.test.ts de ESTE archivo.
  v_gold jsonb := $gold$
  {
    "ventasA":    {"ventas": 1700, "pedidos": 7, "ticket": 242.86, "cobrado_entradas": 1250, "cobrado_salidas": 0, "cobrado_neto": 1250, "saldo_ventas": 450},
    "ventasB":    {"ventas": 100, "pedidos": 1, "ticket": 100, "cobrado_entradas": 300, "cobrado_salidas": 100, "cobrado_neto": 200, "saldo_ventas": 0},
    "porCobrar":  {"total": 450, "pedidos": 3, "a_credito": 350, "vencido": 0},
    "resultadoA": {"ventas": 1700, "devoluciones": 100, "ventas_netas": 1600, "unidades_vendidas": 15, "unidades_sin_costo": 2, "unidades_sin_surtir": 4, "cobertura_pct": 60, "costo_confiable": false, "costo_ventas_conocido": 320, "costo_ventas": null, "utilidad_bruta": null, "margen_bruto_pct": null, "utilidad_neta": null, "margen_neto_pct": null},
    "resultadoB": {"ventas": 100, "devoluciones": 0, "ventas_netas": 100, "unidades_vendidas": 1, "unidades_sin_costo": 0, "unidades_sin_surtir": 0, "cobertura_pct": 100, "costo_confiable": true, "costo_ventas_conocido": 40, "costo_ventas": 40, "utilidad_bruta": 60, "margen_bruto_pct": 60, "gastos": 10, "mermas_conocidas": 0, "utilidad_neta_confiable": true, "utilidad_neta": 50, "margen_neto_pct": 50}
  }
  $gold$;
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos');
  v_p1 uuid := tests.product(100); v_p2 uuid := tests.product(200);
  v_l1 uuid; v_l2 uuid;
  v_hoy date := public.hoy_local();
  c1 date := date_trunc('month', v_hoy)::date;                    -- mes C (en curso)
  b1 date := (date_trunc('month', v_hoy) - interval '1 month')::date; b2 date := c1 - 1;
  a1 date := (date_trunc('month', v_hoy) - interval '2 month')::date; a2 date := b1 - 1;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid; o9 uuid; o10 uuid; op uuid;
  v_ret uuid; v_line uuid; v_ref uuid; v jsonb; w jsonb; v_antes text; v_despues text; v_n int;
  function_item text;
begin
  v_l1 := tests.stock_costo(v_p1, 'W5-C40', 200, 40);     -- costo conocido: 40
  v_l2 := tests.stock_costo(v_p2, 'W5-SIN', 200, null);   -- costo DESCONOCIDO
  perform tests.ok((select unit_cost is null from public.lots where id = v_l2), 'el lote sin costo queda con costo NULL (no se fabrica)');

  -- O1 · 23:30 del último día de A, pagado en B
  o1 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 2)));
  perform tests.fechar(o1, ((a2::timestamp + time '23:30') at time zone 'America/Mazatlan'));
  perform tests.cobrar_el(o1, 200, b1 + 3);
  perform tests.surtir(o1);
  -- O2 · dos pagos parciales en A; el resto a crédito
  o2 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 3)));
  perform tests.fechar(o2, public._kpi_inicio(a1 + 9) + interval '10 hours');
  perform tests.cobrar_el(o2, 100, a1 + 11);
  perform tests.cobrar_el(o2, 50, a1 + 19);
  perform tests.credito(o2);
  perform tests.surtir(o2);
  -- O3 · pagado en A; devuelto y reembolsado en B
  o3 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)));
  perform tests.fechar(o3, public._kpi_inicio(a1 + 14) + interval '12 hours');
  perform tests.cobrar_el(o3, 100, a1 + 14);
  perform tests.surtir(o3);
  perform tests.force_status(o3, 'delivered');
  perform tests.act_as(v_wh);
  v_ret := (public.recibir_devolucion(tests.op(), o3, jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 1, 'inspection', 'ok')), 'devolución de prueba') ->> 'return_id')::uuid;
  perform tests.act_as_owner();
  select id into v_line from public.stock_return_lines where return_id = v_ret;
  perform tests.act_as(v_admin);
  perform public.disponer_devolucion(tests.op(), jsonb_build_array(jsonb_build_object('line_id', v_line, 'disposition', 'vendible')));
  v_ref := (public.autorizar_reembolso(tests.op(), o3, 'devolucion', 100, 'producto devuelto', v_ret) ->> 'refund_id')::uuid;
  perform public.pagar_reembolso(tests.op(), v_ref, 'transferencia', b1 + 1);
  perform tests.act_as_owner();
  -- O4 · pagado en A y CANCELADO
  o4 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)));
  perform tests.fechar(o4, public._kpi_inicio(a1 + 15) + interval '9 hours');
  perform tests.cobrar_el(o4, 100, a1 + 15);
  perform tests.act_as(v_admin);
  perform public.cancelar_pedido(tests.op(), o4, 'cancelación de prueba');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.orders where id = o4), 'cancelled', 'O4 quedó cancelado');
  -- O5 · crédito autorizado sin cobro
  o5 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 2)));
  perform tests.fechar(o5, public._kpi_inicio(a1 + 17) + interval '9 hours');
  perform tests.credito(o5);
  perform tests.surtir(o5);
  -- O6 · producto sin costo conocido
  o6 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p2, 'qty', 1, 'unit_price', 200)));
  perform tests.fechar(o6, public._kpi_inicio(a1 + 19) + interval '9 hours');
  perform tests.cobrar_el(o6, 200, a1 + 19);
  perform tests.surtir(o6);
  -- O7 · mezcla con costo + sin costo
  o7 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1),
                                                    jsonb_build_object('product_id', v_p2, 'qty', 1, 'unit_price', 200)));
  perform tests.fechar(o7, public._kpi_inicio(a1 + 20) + interval '9 hours');
  perform tests.cobrar_el(o7, 300, a1 + 20);
  perform tests.surtir(o7);
  -- O8 · cobrado y sin surtir
  o8 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 4)));
  perform tests.fechar(o8, public._kpi_inicio(a1 + 21) + interval '9 hours');
  perform tests.cobrar_el(o8, 400, a1 + 21);
  -- O9 · primer instante de B
  o9 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)));
  perform tests.fechar(o9, public._kpi_inicio(b1));
  perform tests.cobrar_el(o9, 100, b1);
  perform tests.surtir(o9);
  -- O10 · borrador en A · OP · folio de mostrador con saldo, en 2025
  o10 := tests.order(v_doc, 'draft', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 9)));
  perform tests.fechar(o10, public._kpi_inicio(a1 + 5));
  op := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'qty', 1)), 'pending', null, 'POS-W5-1');
  perform tests.fechar(op, '2025-01-15T18:00:00Z');
  -- Gasto en B
  insert into public.expenses (fecha, categoria, concepto, monto) values (b1 + 6, 'Otros', 'gasto de prueba', 10);

  -- ══ Dorados ═══════════════════════════════════════════════════════════════
  perform tests.jsonb_igual(tests.kpi('ventas', a1, a2), v_gold -> 'ventasA', 'ventas y cobranza del mes A');
  perform tests.jsonb_igual(tests.kpi('ventas', b1, b2), v_gold -> 'ventasB', 'ventas y cobranza del mes B');
  perform tests.jsonb_igual(tests.kpi('por_cobrar'), v_gold -> 'porCobrar', 'por cobrar: posición a hoy');
  perform tests.jsonb_igual(tests.kpi('resultado', a1, a2), v_gold -> 'resultadoA', 'resultado del mes A: costo incompleto ⇒ utilidad y margen NULL');
  perform tests.jsonb_igual(tests.kpi('resultado', b1, b2), v_gold -> 'resultadoB', 'resultado del mes B: costo completo ⇒ utilidad conocida');

  -- ══ Bordes de día y de mes ════════════════════════════════════════════════
  v := tests.kpi('ventas', a2, a2);
  perform tests.eq((v ->> 'ventas')::numeric, 200::numeric, 'borde de mes: el pedido de las 23:30 pertenece al ÚLTIMO día de A');
  v := tests.kpi('ventas', b1, b1);
  perform tests.eq((v ->> 'ventas')::numeric, 100::numeric, 'borde de día: el primer instante de B pertenece a B');
  perform tests.eq((select (created_at at time zone 'UTC')::date from public.orders where id = o1), b1,
    'ese mismo pedido, cortado por UTC, habría caído en el mes B');

  -- ══ Pedido de A pagado en B · pagos parciales · devolución · cancelación ═══
  perform tests.eq((tests.kpi('ventas', a1, a2) ->> 'cobrado_neto')::numeric + (tests.kpi('ventas', b1, b2) ->> 'cobrado_neto')::numeric
                 + (tests.kpi('ventas', c1, v_hoy) ->> 'cobrado_neto')::numeric,
    (select sum(case direction when 'in' then amount else -amount end) from public.payment_entries),
    'Σ cobrado por periodos = Σ del libro (nada se pierde ni se duplica entre meses)');
  perform tests.eq((tests.kpi('ventas') ->> 'cobrado_neto')::numeric,
    (select sum(cobrado_neto) from public.v_order_money),
    'histórico: cobrado neto = Σ v_order_money.cobrado_neto (misma aritmética que W2)');
  perform tests.ok(not exists (select 1 from public._kpi_ventas(null, null) k where k.order_id in (o4, o10)),
    'un pedido cancelado y un borrador no son venta');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = o4 and direction = 'in' and value_date between a1 and a2), 1,
    'pero el dinero del cancelado SÍ entró: sigue en el cobrado de A');
  perform tests.eq((select m.cobrado_neto from public.v_order_money m where m.order_id = o5), 0::numeric,
    'un crédito autorizado no es dinero cobrado');

  -- ══ Costo no confiable ════════════════════════════════════════════════════
  v := tests.kpi('resultado', a1 + 19, a1 + 19);     -- solo O6 (sin costo)
  perform tests.ok((v ->> 'costo_confiable')::boolean is false and v -> 'utilidad_bruta' = 'null'::jsonb
               and (v ->> 'unidades_sin_costo')::int = 1 and (v ->> 'costo_ventas_conocido')::numeric = 0,
    'venta sin costo conocido: el costo NO es 0, la utilidad es NULL');
  perform tests.ok((v ->> 'cobertura_pct')::int = 0, 'y la cobertura es 0%, no 100%');
  v := tests.kpi('resultado', a1 + 20, a1 + 20);     -- solo O7 (mezcla)
  perform tests.ok((v ->> 'costo_confiable')::boolean is false and (v ->> 'costo_ventas_conocido')::numeric = 40
               and (v ->> 'cobertura_pct')::int = 50 and v -> 'utilidad_bruta' = 'null'::jsonb,
    'mezcla con y sin costo: se reporta lo conocido (40) y la utilidad sigue siendo NULL');
  v := tests.kpi('resultado', a1 + 21, a1 + 21);     -- solo O8 (sin surtir)
  perform tests.ok((v ->> 'costo_confiable')::boolean is false and (v ->> 'unidades_sin_surtir')::int = 4
               and (v ->> 'cobertura_pct')::int = 0 and v -> 'utilidad_bruta' = 'null'::jsonb,
    'venta cobrada sin surtir: sin costo todavía ⇒ utilidad NULL (antes: margen 100% sin aviso)');
  v := tests.kpi('resultado', a1 + 14, a1 + 14);     -- solo O3 (devuelto)
  perform tests.ok((v ->> 'costo_confiable')::boolean and (v ->> 'costo_ventas')::numeric = 0
               and (v ->> 'ventas_netas')::numeric = 0 and (v ->> 'utilidad_bruta')::numeric = 0,
    'devolución: el costo regresa con su costo congelado y la venta neta queda en 0');

  -- ══ Mermas (por fecha del movimiento: mes C) ══════════════════════════════
  perform tests.act_as(v_admin);
  perform public.ajustar_lote(tests.op(), v_l1, -1, 'merma', 'frasco roto');
  perform tests.act_as_owner();
  v := tests.kpi('resultado', c1, v_hoy);
  perform tests.ok((v ->> 'mermas_conocidas')::numeric = 40 and (v ->> 'utilidad_neta')::numeric = -40
               and (v ->> 'utilidad_neta_confiable')::boolean,
    'merma con costo conocido: resta a la utilidad neta');
  perform tests.act_as(v_admin);
  perform public.ajustar_lote(tests.op(), v_l2, -1, 'merma', 'frasco roto sin costo');
  perform tests.act_as_owner();
  v := tests.kpi('resultado', c1, v_hoy);
  perform tests.ok((v ->> 'merma_unidades_sin_costo')::int = 1 and v -> 'utilidad_neta' = 'null'::jsonb
               and (v ->> 'utilidad_neta_confiable')::boolean is false and (v ->> 'utilidad_bruta')::numeric = 0,
    'merma SIN costo: la utilidad neta es NULL (la merma no vale 0); la bruta no se contamina');

  -- ══ Equivalencia servidor ⇔ SQL directo (escrito aparte, por día del negocio) ══
  for function_item in select unnest(array['A', 'B', 'C', 'TODO']) loop
    declare d1 date := case function_item when 'A' then a1 when 'B' then b1 when 'C' then c1 end;
            d2 date := case function_item when 'A' then a2 when 'B' then b2 when 'C' then v_hoy end;
    begin
      v := tests.kpi('ventas', d1, d2);
      select jsonb_build_object(
               'ventas', coalesce(sum(o.total), 0), 'pedidos', count(*),
               'saldo_ventas', coalesce(sum(greatest(o.total - coalesce((select sum(case e.direction when 'in' then e.amount else -e.amount end)
                                                                    from public.payment_entries e where e.order_id = o.id), 0), 0)), 0))
        into w
        from public.orders o
       where o.status not in ('cancelled', 'draft', 'pending_payment')
         and (d1 is null or public.dia_negocio(o.created_at) between d1 and d2);
      w := w || (select jsonb_build_object(
               'cobrado_entradas', coalesce(sum(amount) filter (where direction = 'in'), 0),
               'cobrado_salidas', coalesce(sum(amount) filter (where direction = 'out'), 0))
            from public.payment_entries where d1 is null or value_date between d1 and d2);
      perform tests.jsonb_igual(v, w, 'kpi_ventas ⇔ SQL directo · periodo ' || function_item);

      v := tests.kpi('resultado', d1, d2);
      with ventas as (select o.id, o.total from public.orders o
                       where o.status not in ('cancelled', 'draft', 'pending_payment')
                         and (d1 is null or public.dia_negocio(o.created_at) between d1 and d2)),
      u as (select v2.id,
                   coalesce((select sum(qty) from public.order_items i where i.order_id = v2.id), 0) as vendidas,
                   coalesce((select sum(-change) from public.inventory_movements m
                              where m.order_id = v2.id and m.reason in ('surtido', 'venta')), 0) as salidas,
                   coalesce((select sum(abs(change)) from public.inventory_movements m
                              where m.order_id = v2.id and m.reason in ('surtido', 'venta', 'cancelacion', 'devolucion') and m.unit_cost is null), 0) as sin_costo,
                   coalesce((select sum(-change * unit_cost) from public.inventory_movements m
                              where m.order_id = v2.id and m.reason in ('surtido', 'venta', 'cancelacion', 'devolucion')), 0) as costo
              from ventas v2)
      select jsonb_build_object(
               'ventas', (select coalesce(sum(total), 0) from ventas),
               'devoluciones', (select coalesce(sum(r.monto), 0) from public.refunds r where r.order_id in (select id from ventas)),
               'unidades_vendidas', coalesce(sum(vendidas), 0),
               'unidades_sin_costo', coalesce(sum(sin_costo), 0),
               'unidades_sin_surtir', coalesce(sum(greatest(vendidas - salidas, 0)), 0),
               'costo_ventas_conocido', coalesce(sum(costo), 0),
               'gastos', (select coalesce(sum(monto), 0) from public.expenses where d1 is null or fecha between d1 and d2))
        into w from u;
      perform tests.jsonb_igual(v, w, 'kpi_resultado ⇔ SQL directo · periodo ' || function_item);
    end;
  end loop;
  select jsonb_build_object('total', coalesce(sum(m.saldo), 0), 'pedidos', count(*))
    into w from public.v_order_money m join public.orders o on o.id = m.order_id
   where m.saldo > 0.0001 and o.status not in ('cancelled', 'draft') and o.external_ref not like 'POS%';
  perform tests.jsonb_igual(tests.kpi('por_cobrar'), w, 'kpi_por_cobrar ⇔ SQL directo');
  perform tests.ok((select m.saldo > 0 from public.v_order_money m where m.order_id = op),
    'el folio de mostrador tiene saldo, y aun así queda fuera de "por cobrar" (regla vigente)');

  -- ══ Solo lectura: nada cambia por consultar ═══════════════════════════════
  perform tests.ok((select bool_and(p.provolatile = 's') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('kpi_ventas', 'kpi_por_cobrar', 'kpi_resultado', '_kpi_ventas', '_kpi_inicio', 'dia_negocio')),
    'todas las funciones de W5 son STABLE: Postgres les prohíbe escribir');
  select md5(row(
           (select count(*) from public.orders), (select sum(total) from public.orders), (select count(*) from public.order_items),
           (select count(*) from public.payment_entries), (select sum(amount) from public.payment_entries),
           (select count(*) from public.inventory_movements), (select sum(quantity) from public.lots),
           (select count(*) from public.refunds), (select count(*) from public.expenses),
           (select count(*) from public.money_operations), (select count(*) from public.inventory_operations),
           (select count(*) from public.fiscal_documents), (select count(*) from public.comm_outbox),
           (select count(*) from public.audit_logs))::text) into v_antes;
  perform tests.kpi('ventas'); perform tests.kpi('ventas', a1, a2); perform tests.kpi('por_cobrar');
  perform tests.kpi('resultado'); perform tests.kpi('resultado', b1, b2);
  select md5(row(
           (select count(*) from public.orders), (select sum(total) from public.orders), (select count(*) from public.order_items),
           (select count(*) from public.payment_entries), (select sum(amount) from public.payment_entries),
           (select count(*) from public.inventory_movements), (select sum(quantity) from public.lots),
           (select count(*) from public.refunds), (select count(*) from public.expenses),
           (select count(*) from public.money_operations), (select count(*) from public.inventory_operations),
           (select count(*) from public.fiscal_documents), (select count(*) from public.comm_outbox),
           (select count(*) from public.audit_logs))::text) into v_despues;
  perform tests.eq(v_despues, v_antes, 'consultar indicadores no cambia pedidos, cobros, inventario, fiscal, mensajes ni bitácora');

  -- ══ Más de 1,000 pedidos ══════════════════════════════════════════════════
  insert into public.orders (id, external_ref, doctor_id, total, status, payment_method, payment_status, created_at)
  select gen_random_uuid(), 'W5M' || g, v_doc, 10, 'delivered', 'transferencia', 'pending',
         '2024-03-01T07:00:00Z'::timestamptz + (g || ' minutes')::interval * 19
    from generate_series(1, 2500) g;
  v := tests.kpi('ventas', '2024-03-01', '2024-03-31');
  select count(*) into v_n from public.orders where external_ref like 'W5M%' and public.dia_negocio(created_at) between '2024-03-01' and '2024-03-31';
  perform tests.ok(v_n > 1000 and v_n < 2500, 'el mes de prueba tiene más de 1,000 pedidos y deja algunos fuera del periodo (' || v_n || ')');
  perform tests.eq((v ->> 'pedidos')::int, v_n, 'más de 1,000 pedidos: se cuentan todos, sin truncar');
  perform tests.eq((v ->> 'ventas')::numeric, (v_n * 10)::numeric, 'y la suma es exacta');
  perform tests.eq((tests.kpi('ventas', '2024-03-01', '2024-04-30') ->> 'pedidos')::int, 2500, 'ampliando el periodo aparecen los 2,500');
end $t$;
rollback;
