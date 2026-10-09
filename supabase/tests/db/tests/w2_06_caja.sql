-- W2 · CORTE DE CAJA. F-10: el esperado lo calcula el SERVIDOR desde el libro (D-W2-7).
-- D-W2-CASH-CUTOFF: un corte cerrado establece un LÍMITE ECONÓMICO — el corte siguiente
-- del mismo alcance arquea SOLO el efectivo posterior, nunca el ya arqueado. Una anulación
-- no establece límite: reabre el tramo. Nada de esto se resta en el cliente.
-- SEC-B (139): el efectivo del POS entra SOLO por vender_pos (D-SEC-1) y el POS solo cierra SU corte de cajero (D-SECB-2);
-- los cortes del DÍA los cierran Facturación/Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_r jsonb; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_cj uuid;
  v_hoy date := public.hoy_local(); v_op uuid; v_desde timestamptz; v_hasta timestamptz;
begin
  perform tests.stock(v_p, 'W2-CJ', 200);
  v_o  := tests.order(v_doc, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  v_o2 := tests.order(v_doc, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));

  -- ── 10) El ESPERADO no se puede enviar: no existe ese parámetro ────────────────
  perform tests.ok(not exists (
    select 1 from information_schema.parameters
     where specific_schema = 'public' and parameter_name = 'p_esperado'
       and specific_name like 'registrar_corte_caja%'),
    'F-10/10: registrar_corte_caja NO acepta un esperado del cliente');
  perform tests.ok(exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'efectivo_esperado' and p.prosecdef),
    '10: el esperado se obtiene de una función del servidor (security definer)');

  -- ── 1) PRIMER corte del día: arranca en el inicio del día local ───────────────
  perform tests.venta_pos(v_pos, 200);                 -- venta de mostrador en efectivo
  perform tests.venta_pos(v_pos, 100, 'tarjeta');      -- no es efectivo: fuera del arqueo
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''dia'', 500, 700)', v_hoy),
    'solo puedes cerrar tu propio corte', 'SEC-B: el POS no cierra el corte del día');
  perform tests.act_as(v_bill);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 200::numeric,
    '1: el esperado sale del libro y solo cuenta efectivo');
  v_r := public.tramo_corte_caja(v_hoy, 'dia', null);
  perform tests.ok((v_r ->> 'primer_corte')::boolean, '1: el primero se reconoce como primer corte del alcance');
  perform tests.eq((v_r ->> 'desde')::timestamptz, (v_hoy::timestamp at time zone 'America/Mazatlan'),
    '1: el tramo arranca al inicio del día LOCAL del negocio');

  v_r := public.registrar_corte_caja(tests.op(), v_hoy, 'dia', 500, 700);
  v_c1 := (v_r ->> 'closing_id')::uuid;
  perform tests.eq((v_r ->> 'esperado')::numeric, 200::numeric, '1: el corte toma el esperado del servidor');
  perform tests.eq((v_r ->> 'diferencia')::numeric, 0::numeric, '1: contado 700 = esperado 200 + fondo 500');
  perform tests.ok((v_r -> 'continua_de') = 'null'::jsonb, '1: el primer corte no continúa a nadie');

  -- ── 5) CERO movimientos desde el último corte ⇒ esperado 0 ────────────────────
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 0::numeric,
    '5: sin movimientos nuevos, el esperado del siguiente corte es 0');
  v_r := public.registrar_corte_caja(tests.op(), v_hoy, 'dia', 0, 0);
  v_c2 := (v_r ->> 'closing_id')::uuid;
  perform tests.eq((v_r ->> 'esperado')::numeric, 0::numeric, '5: el corte vacío cuadra en 0 (nada que arquear)');
  perform tests.eq((v_r ->> 'continua_de')::uuid, v_c1, '5: el corte nuevo CONTINÚA al anterior');
  perform tests.act_as_owner();
  perform tests.eq((select corte_desde from public.cash_closings where id = v_c2),
                   (select corte_hasta from public.cash_closings where id = v_c1),
    '2/5: el tramo nuevo empieza exactamente donde terminó el anterior (sin hueco ni traslape)');

  -- ── 3) MOVIMIENTOS ENTRE CORTES: el segundo toma SOLO los nuevos ─────────────
  perform tests.venta_pos(v_pos, 50);
  perform tests.venta_pos(v_pos, 30);
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.efectivo_esperado(%L, ''dia'', null)', v_hoy), 'solo puedes consultar tu propio corte',
    'SEC-C1: el POS no consulta el arqueo del día');
  perform tests.act_as(v_bill);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 80::numeric,
    '3: el esperado es SOLO el efectivo posterior al último corte (no vuelve a contar los 200)');
  perform tests.act_as(v_admin);
  v_r := public.registrar_corte_caja(tests.op(), v_hoy, 'dia', 0, 80);
  v_c3 := (v_r ->> 'closing_id')::uuid;
  perform tests.eq((v_r ->> 'esperado')::numeric, 80::numeric, '3: el tercer corte arquea 80, no 280');
  perform tests.eq((v_r ->> 'diferencia')::numeric, 0::numeric, '3: no aparece un sobrante falso por doble conteo');

  -- ── 2) SEGUNDO corte: los tramos cubren el día una sola vez ──────────────────
  perform tests.act_as_owner();
  perform tests.eq((select sum(esperado) from public.cash_closings where voids_closing_id is null), 280::numeric,
    '2/8: la suma de los tramos = efectivo del día (cada peso arqueado UNA vez)');
  perform tests.eq((select count(*)::int from public.cash_closings c
                     where exists (select 1 from public.cash_closings x
                                    where x.id <> c.id and x.alcance = c.alcance
                                      and x.cajero is not distinct from c.cajero
                                      and x.voids_closing_id is null and c.voids_closing_id is null
                                      and x.corte_desde < c.corte_hasta and c.corte_desde < x.corte_hasta)), 0,
    '8: ningún par de cortes vigentes traslapa su tramo');

  -- ── 7) REINTENTO con el MISMO op_id ⇒ idempotente, sin reclamar otro tramo ────
  perform tests.venta_pos(v_pos, 10);
  perform tests.act_as(v_bill);
  v_op := tests.op();
  v_r := public.registrar_corte_caja(v_op, v_hoy, 'dia', 0, 10);
  perform tests.eq(v_r ->> 'status', 'applied', '7: el corte se registra');
  perform tests.eq(public.registrar_corte_caja(v_op, v_hoy, 'dia', 0, 10) ->> 'status', 'already_applied',
    '7: el reintento con el mismo op_id NO crea otro corte');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cash_closings where op_id = v_op), 1,
    '7: un op_id = un corte (sin doble reclamo del tramo)');

  -- ── 8) DOBLE CONTABILIZACIÓN del mismo tramo: imposible ──────────────────────
  -- El respaldo DURO: aunque algo se saltara los comandos, la base no deja que dos
  -- cortes arranquen donde terminó el mismo corte.
  perform tests.act_as_owner();
  perform tests.throws(format($q$insert into public.cash_closings
      (id, fecha, alcance, esperado, fondo, contado, diferencia, usuario, corte_desde, corte_hasta, prev_closing_id)
      values (gen_random_uuid(), %L, 'dia', 0, 0, 0, 0, 'x', now() - interval '1 min', now(), %L)$q$, v_hoy, v_c1),
    'uq_cierre_cadena', '8: dos cortes no pueden reclamar el tramo que sigue al mismo corte');
  perform tests.throws(format($q$insert into public.cash_closings
      (id, fecha, alcance, esperado, fondo, contado, diferencia, usuario, corte_desde, corte_hasta)
      values (gen_random_uuid(), %L, 'dia', 0, 0, 0, 0, 'x', now() - interval '1 min', now())$q$, v_hoy),
    'uq_cierre_cadena_inicio', '8: tampoco puede haber dos "primeros cortes" del mismo alcance');
  perform tests.eq((select count(*)::int from public.cash_closings a join public.cash_closings b
                     on a.prev_closing_id = b.prev_closing_id and a.id <> b.id
                    where a.prev_closing_id is not null), 0,
    '8: la cadena de cortes es lineal (ningún tramo reclamado dos veces)');

  -- ── 6) CAJEROS DISTINTOS: cada cajero tiene su PROPIA cadena ─────────────────
  -- Los alcances 'dia' y 'cajero' son cadenas separadas por diseño (la decisión acota el
  -- límite a "un mismo alcance/cajero"): cerrar el turno de un cajero no cierra el día.
  perform tests.venta_pos(v_pos, 25);                  -- recibido por POS
  perform tests.act_as(v_pos);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_pos), 315::numeric,
    '6: el primer corte del cajero cubre TODO lo que él recibió en el día (200+50+30+10+25)');
  perform tests.throws(format('select public.efectivo_esperado(%L, ''cajero'', %L)', v_hoy, v_bill), 'solo puedes consultar tu propio corte',
    'SEC-C1: el POS no consulta el arqueo de otro cajero');
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''cajero'', 0, 315, null, %L)', v_hoy, v_bill),
    'solo puedes cerrar tu propio corte', 'SEC-B: el POS no cierra el corte de otro cajero');
  perform tests.act_as(v_bill);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_bill), 0::numeric,
    '6: otro cajero no arquea efectivo ajeno');
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''cajero'', 0, 315, null, %L)', v_hoy, v_bill),
    'MOTIVO_REQUERIDO', '6: el corte de un cajero sin efectivo propio no puede cuadrar con dinero ajeno');
  perform tests.act_as(v_pos);
  v_r := public.registrar_corte_caja(tests.op(), v_hoy, 'cajero', 0, 315, null, v_pos);
  v_cj := (v_r ->> 'closing_id')::uuid;
  perform tests.eq((v_r ->> 'esperado')::numeric, 315::numeric, '6: el cajero cierra su propio tramo');
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_pos), 0::numeric,
    '6: su tramo queda cerrado y no se vuelve a arquear');
  perform tests.act_as(v_bill);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 25::numeric,
    '6: la cadena del DÍA es independiente: ahí solo queda pendiente lo posterior a su último corte');
  perform tests.act_as_owner();
  perform tests.eq((select cajero from public.cash_closings where id = v_cj), v_pos, '6: el corte guarda a su cajero');
  perform tests.ok((select prev_closing_id is null from public.cash_closings where id = v_cj),
    '6: el primer corte del cajero arranca su propia cadena');

  -- ── 4) CORTE ANULADO: no establece límite ⇒ su tramo se REABRE ───────────────
  perform tests.act_as(v_admin);
  perform tests.eq(public.registrar_corte_caja(tests.op(), v_hoy, 'dia', 0, 25) ->> 'esperado', '25',
    '4: se cierra el día para tener un último corte que anular');
  perform tests.act_as_owner();
  -- La COLA de la cadena del día: el corte al que nadie continúa (no se puede ordenar por
  -- created_at dentro de una transacción, ahí now() es constante).
  select c.id into v_c3 from public.cash_closings c
   where c.alcance = 'dia' and c.cajero is null
     and not exists (select 1 from public.cash_closings x where x.prev_closing_id = c.id);
  perform tests.act_as(v_admin);
  v_r := public.anular_corte_caja(tests.op(), v_c3, 'conteo mal capturado');
  perform tests.eq(v_r ->> 'status', 'applied', '4: Dirección anula por compensación');
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 25::numeric,
    '4: el tramo del corte anulado vuelve a estar por arquear');
  v_r := public.registrar_corte_caja(tests.op(), v_hoy, 'dia', 0, 25);
  perform tests.eq((v_r ->> 'esperado')::numeric, 25::numeric, '4: el corte de reemplazo recupera el tramo liberado');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cash_closings where voids_closing_id = v_c3), 1,
    '4: la anulación es una FILA NUEVA, no un borrado');
  perform tests.ok((select prev_closing_id = v_c3 from public.cash_closings where voids_closing_id = v_c3),
    '4: la anulación entra a la CADENA (nadie más puede arrancar desde el corte anulado)');
  perform tests.eq((select sum(esperado) from public.cash_closings), 630::numeric,
    '4: con la compensación, la suma de esperados sigue cuadrando con el libro');

  -- ── Autoridad y validaciones ──────────────────────────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.anular_corte_caja(gen_random_uuid(), %L, ''me equivoqué'')', v_c1),
    'NO_AUTORIZADO', 'POS no anula cortes');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.anular_corte_caja(gen_random_uuid(), %L, ''  '')', v_c1),
    'MOTIVO_REQUERIDO', 'la anulación exige motivo');
  perform tests.throws(format('select public.anular_corte_caja(gen_random_uuid(), %L, ''viejo'')', v_c1),
    'CORTE_NO_ES_EL_ULTIMO', 'solo se anula el corte más reciente: anular uno intermedio dejaría huecos');
  perform tests.throws(format('select public.anular_corte_caja(gen_random_uuid(), %L, ''otra vez'')', v_c3),
    'CORTE_YA_ANULADO', 'un corte se anula una sola vez');
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''dia'', 0, 0)', v_hoy + 1),
    'FECHA_FUTURA', 'no se cierra caja de un día futuro');
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''cajero'', 0, 0)', v_hoy),
    'CAJERO_REQUERIDO', 'el alcance por cajero exige indicar cajero');
  perform tests.venta_pos(v_pos, 5);
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 5)', v_o2),
    'NO_AUTORIZADO', 'SEC-B: el POS no registra cobros directos (cobra solo por vender_pos)');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L, ''dia'', 0, 999)', v_hoy),
    'MOTIVO_REQUERIDO', 'una diferencia exige explicación');
  perform tests.act_as(tests.user('warehouse'));
  perform tests.throws(format('select public.efectivo_esperado(%L, ''dia'', null)', v_hoy),
    'NO_AUTORIZADO', 'el esperado no se consulta desde Almacén');

  -- ── D8: efectivo que aterriza DENTRO de un tramo ya cerrado se detecta ───────
  -- (única forma de que un arqueo cerrado deje de ser cierto: una escritura que
  --  se confirmó después del corte con un instante anterior a su cierre)
  perform tests.act_as_owner();
  select corte_desde, corte_hasta into v_desde, v_hasta from public.cash_closings where id = v_c1;
  insert into public.payment_entries (id, order_id, direction, method, amount, value_date, actor_role, created_at)
  values (gen_random_uuid(), v_o2, 'in', 'efectivo', 7, v_hoy, 'pos', v_desde + ((v_hasta - v_desde) / 2));
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero()
                     where check_id = 'D8_corte_vs_libro' and entidad_id = v_c1), 1,
    'D8: un asiento dentro de un tramo ya cortado rompe el arqueo y se reporta');
end
$t$;
set constraints all immediate;
rollback;
