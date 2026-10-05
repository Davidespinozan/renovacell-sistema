-- ============================================================================
-- W5 · KPIs DE CABECERA CON AUTORIDAD EN SERVIDOR (SOLO LECTURA)
--
-- Qué resuelve
--   · Un solo reloj: `dia_negocio(instante)` es el día del negocio de CUALQUIER
--     instante, con la misma zona que `hoy_local()` de W1. `hoy_local()` no se toca:
--     su equivalencia (`hoy_local() = dia_negocio(now())`) queda bajo prueba.
--   · Una sola definición por cifra de cabecera — ventas, cobrado, por cobrar y
--     utilidad con su cobertura de costo — calculada en el servidor.
--
-- Qué NO es
--   · No es otra verdad económica. Todo sale de las fuentes canónicas que ya existen:
--       ventas ............ orders                    (W1)
--       cobrado ........... payment_entries           (W2, el libro)
--       por cobrar ........ v_order_money.saldo       (W2, definición única)
--       costo de ventas ... inventory_movements       (W1/W2-C, costo congelado)
--       devoluciones ...... refunds                   (W2)
--       gastos ............ expenses
--   · No escribe nada: todas las funciones son STABLE (Postgres rechaza cualquier
--     INSERT/UPDATE/DELETE dentro de una función STABLE).
--
-- Autoridad
--   · kpi_ventas / kpi_por_cobrar .. Dirección y Facturación (`admin`, `billing`): los
--     mismos dos roles que ya leen el libro de pagos completo desde W2. No amplía lo
--     que Facturación puede ver; solo se lo entrega ya sumado.
--   · kpi_resultado ................ SOLO Dirección. Costo, utilidad y margen no
--     existen en ninguna otra función.
--   SECURITY DEFINER + search_path fijo, como `conciliar_dinero` y `efectivo_esperado`.
--
-- Rollback: supabase/rollback/w5/99_down.sql (funciones e índices; ningún dato).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) RELOJ DEL NEGOCIO
-- ---------------------------------------------------------------------------
create function public.dia_negocio(p_instante timestamptz) returns date
  language sql stable set search_path = public as
$$ select (p_instante at time zone 'America/Mazatlan')::date $$;

comment on function public.dia_negocio(timestamptz) is
  'W5 · día del negocio (America/Mazatlan) de un instante. Misma zona que hoy_local(): hoy_local() = dia_negocio(now()).';

-- Instante en que EMPIEZA un día del negocio. Un periodo [desde, hasta] de días se
-- traduce a [_kpi_inicio(desde), _kpi_inicio(hasta + 1)) sobre columnas timestamptz:
-- mismo resultado que comparar dia_negocio(columna), pero aprovechando el índice.
create function public._kpi_inicio(p_dia date) returns timestamptz
  language sql stable set search_path = public as
$$ select (p_dia::timestamp) at time zone 'America/Mazatlan' $$;

-- ---------------------------------------------------------------------------
-- 2) QUÉ PEDIDOS SON "VENTA" EN UN PERIODO — definición única
--    Venta = pedido confirmado: ni cancelado, ni borrador, ni pendiente de pago.
--    Se atribuye al día del negocio en que se levantó el pedido.
-- ---------------------------------------------------------------------------
create function public._kpi_ventas(p_desde date, p_hasta date)
returns table (order_id uuid, total numeric)
  language sql stable security definer set search_path = public as
$$
  select o.id, coalesce(o.total, 0)
    from public.orders o
   where o.status is not null
     and o.status not in ('cancelled', 'draft', 'pending_payment')
     and (p_desde is null or o.created_at >= public._kpi_inicio(p_desde))
     and (p_hasta is null or o.created_at <  public._kpi_inicio(p_hasta + 1))
$$;

-- ---------------------------------------------------------------------------
-- 3) VENTAS Y COBRANZA DEL PERIODO
--    · ventas / pedidos / ticket ..... por día del negocio del PEDIDO.
--    · cobrado ....................... por FECHA CONTABLE del asiento en el libro
--      (payment_entries.value_date), sea cual sea la fecha del pedido. Un pedido de
--      septiembre pagado en octubre es dinero de octubre. Misma aritmética que
--      v_order_money: entradas = Σ in, salidas = Σ out, neto = entradas − salidas.
--    · saldo_ventas .................. de lo vendido en el periodo, lo que aún falta
--      cobrar (Σ saldo > 0 del libro para ESOS pedidos).
-- ---------------------------------------------------------------------------
create function public.kpi_ventas(p_desde date default null, p_hasta date default null)
returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_ventas numeric; v_pedidos int; v_saldo numeric;
  v_in numeric; v_out numeric;
begin
  if not (public.auth_role() = any (array['admin', 'billing'])) then
    raise exception 'NO_AUTORIZADO: ventas y cobranza son de Dirección y Facturación';
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'PERIODO_INVALIDO: el periodo termina antes de empezar';
  end if;

  select coalesce(sum(v.total), 0), count(*)::int,
         coalesce(sum(greatest(m.saldo, 0)), 0)
    into v_ventas, v_pedidos, v_saldo
    from public._kpi_ventas(p_desde, p_hasta) v
    join public.v_order_money m on m.order_id = v.order_id;

  select coalesce(sum(e.amount) filter (where e.direction = 'in'), 0),
         coalesce(sum(e.amount) filter (where e.direction = 'out'), 0)
    into v_in, v_out
    from public.payment_entries e
   where (p_desde is null or e.value_date >= p_desde)
     and (p_hasta is null or e.value_date <= p_hasta);

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'ventas', v_ventas,
    'pedidos', v_pedidos,
    'ticket', case when v_pedidos > 0 then round(v_ventas / v_pedidos, 2) else 0 end,
    'cobrado_entradas', v_in,
    'cobrado_salidas', v_out,
    'cobrado_neto', v_in - v_out,
    'saldo_ventas', v_saldo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) POR COBRAR — POSICIÓN A HOY (no depende de un periodo)
--    Saldo del libro de cada pedido cobrable: ni cancelado ni borrador, y fuera el
--    mostrador (POS se cobra en el acto). Un crédito autorizado SIGUE siendo deuda;
--    se separa lo que está a crédito y lo ya vencido.
-- ---------------------------------------------------------------------------
create function public.kpi_por_cobrar()
returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v jsonb;
begin
  if not (public.auth_role() = any (array['admin', 'billing'])) then
    raise exception 'NO_AUTORIZADO: ventas y cobranza son de Dirección y Facturación';
  end if;
  select jsonb_build_object(
           'total',     coalesce(sum(m.saldo), 0),
           'pedidos',   count(*)::int,
           'a_credito', coalesce(sum(m.saldo) filter (where m.credito_autorizado), 0),
           'vencido',   coalesce(sum(m.saldo) filter (where m.credito_autorizado and m.vencido), 0),
           'al_dia',    public.hoy_local())
    into v
    from public.v_order_money m
   where m.saldo > 0.0001
     and coalesce(m.order_status, '') not in ('cancelled', 'draft')
     and coalesce(m.external_ref, '') not like 'POS%';
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) RESULTADO DEL PERIODO — utilidad y COBERTURA DE COSTO (solo Dirección)
--
--    El costo se empareja con la venta: es el costo CONGELADO de los movimientos de
--    kardex de ESOS pedidos (salidas por surtido/venta menos regresos por
--    cancelación/devolución), no "lo que se movió en el almacén esas fechas".
--
--    Cada unidad vendida cae en exactamente uno de tres estados:
--      con costo ........ salió del almacén y su movimiento trae costo;
--      sin costo ........ salió, pero el movimiento no trae costo (desconocido);
--      sin surtir ....... todavía no sale: su costo no existe aún.
--    Un costo desconocido NUNCA se cuenta como cero. Si queda una sola unidad sin
--    costo o sin surtir, `costo_confiable` es false y la utilidad y el margen se
--    devuelven NULL: quien consuma esta función no puede pintar una utilidad que
--    no se conoce. Lo que sí se conoce va en `costo_ventas_conocido`.
-- ---------------------------------------------------------------------------
create function public.kpi_resultado(p_desde date default null, p_hasta date default null)
returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_ventas numeric; v_dev numeric; v_netas numeric;
  v_vendidas numeric; v_salidas numeric; v_sin_costo numeric; v_sin_surtir numeric;
  v_costo numeric; v_gastos numeric; v_mermas numeric; v_merma_sin numeric;
  v_ok boolean; v_ok_neta boolean; v_bruta numeric; v_neta numeric; v_pct int;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: costo y utilidad son de Dirección';
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'PERIODO_INVALIDO: el periodo termina antes de empezar';
  end if;

  select coalesce(sum(v.total), 0) into v_ventas from public._kpi_ventas(p_desde, p_hasta) v;

  select coalesce(sum(r.monto), 0) into v_dev
    from public.refunds r
   where r.order_id in (select v.order_id from public._kpi_ventas(p_desde, p_hasta) v);
  v_netas := v_ventas - v_dev;

  -- Por pedido: lo vendido contra lo que realmente salió del almacén.
  with ventas as (select v.order_id from public._kpi_ventas(p_desde, p_hasta) v),
  vendidas as (
    select oi.order_id, sum(oi.qty)::numeric as qty
      from public.order_items oi join ventas v on v.order_id = oi.order_id
     where oi.product_id is not null
     group by oi.order_id
  ),
  mov as (
    select m.order_id,
           coalesce(sum(-m.change) filter (where m.reason in ('surtido', 'venta') and m.change < 0), 0)::numeric as salidas,
           coalesce(sum(abs(m.change)) filter (where m.unit_cost is null), 0)::numeric as sin_costo,
           coalesce(sum(-m.change * m.unit_cost), 0) as costo   -- salida suma, regreso resta; NULL no aporta
      from public.inventory_movements m join ventas v on v.order_id = m.order_id
     where (m.reason in ('surtido', 'venta') and m.change < 0)
        or (m.reason in ('cancelacion', 'devolucion') and m.change > 0)
     group by m.order_id
  )
  select coalesce(sum(coalesce(vd.qty, 0)), 0),
         coalesce(sum(coalesce(mv.salidas, 0)), 0),
         coalesce(sum(coalesce(mv.sin_costo, 0)), 0),
         coalesce(sum(greatest(coalesce(vd.qty, 0) - coalesce(mv.salidas, 0), 0)), 0),
         coalesce(sum(coalesce(mv.costo, 0)), 0)
    into v_vendidas, v_salidas, v_sin_costo, v_sin_surtir, v_costo
    from ventas v
    left join vendidas vd on vd.order_id = v.order_id
    left join mov mv on mv.order_id = v.order_id;

  select coalesce(sum(g.monto), 0) into v_gastos
    from public.expenses g
   where (p_desde is null or g.fecha >= p_desde) and (p_hasta is null or g.fecha <= p_hasta);

  select coalesce(sum(-m.change * m.unit_cost), 0),
         coalesce(sum(-m.change) filter (where m.unit_cost is null), 0)
    into v_mermas, v_merma_sin
    from public.inventory_movements m
   where m.reason = 'merma' and m.change < 0
     and (p_desde is null or m.created_at >= public._kpi_inicio(p_desde))
     and (p_hasta is null or m.created_at <  public._kpi_inicio(p_hasta + 1));

  v_ok      := v_sin_costo = 0 and v_sin_surtir = 0;
  v_ok_neta := v_ok and v_merma_sin = 0;
  v_bruta   := case when v_ok then v_netas - v_costo end;
  v_neta    := case when v_ok_neta then v_netas - v_costo - v_gastos - v_mermas end;
  -- Cobertura: unidades vendidas cuyo costo se conoce. Nunca dice 100 si no es confiable.
  v_pct := case when v_vendidas <= 0 then 100
                else floor(100 * greatest(v_vendidas - v_sin_surtir - v_sin_costo, 0) / v_vendidas)::int end;
  if not v_ok then v_pct := least(v_pct, 99); end if;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'ventas', v_ventas,
    'devoluciones', v_dev,
    'ventas_netas', v_netas,
    'unidades_vendidas', v_vendidas,
    'unidades_sin_costo', v_sin_costo,
    'unidades_sin_surtir', v_sin_surtir,
    'cobertura_pct', v_pct,
    'costo_confiable', v_ok,
    'costo_ventas_conocido', v_costo,
    'costo_ventas', case when v_ok then v_costo end,
    'utilidad_bruta', v_bruta,
    'margen_bruto_pct', case when v_ok and v_netas > 0 then round(100 * v_bruta / v_netas, 1) end,
    'gastos', v_gastos,
    'mermas_conocidas', v_mermas,
    'merma_unidades_sin_costo', v_merma_sin,
    'utilidad_neta_confiable', v_ok_neta,
    'utilidad_neta', v_neta,
    'margen_neto_pct', case when v_ok_neta and v_netas > 0 then round(100 * v_neta / v_netas, 1) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) ÍNDICES — solo los que el planificador USA para las consultas de arriba
--    (medido con EXPLAIN ANALYZE sobre 20,000 pedidos en el cluster de pruebas).
-- ---------------------------------------------------------------------------
-- _kpi_ventas: rango de created_at de los pedidos del periodo. Sin índice es un
-- recorrido completo de `orders` en cada consulta de indicadores.
create index idx_orders_created_at on public.orders (created_at);
-- kpi_ventas: cobrado por fecha contable. El índice existente (order_id, value_date)
-- no sirve para un rango de fechas a través de todos los pedidos.
create index idx_payment_entries_value_date on public.payment_entries (value_date);
-- (Se evaluó un índice en order_items(order_id): las consultas de W5 no lo usan, así
--  que no se crea aquí.)

-- ---------------------------------------------------------------------------
-- 7) PRIVILEGIOS
-- ---------------------------------------------------------------------------
revoke all on function
  public.kpi_ventas(date, date),
  public.kpi_por_cobrar(),
  public.kpi_resultado(date, date)
  from public, anon;
grant execute on function
  public.kpi_ventas(date, date),
  public.kpi_por_cobrar(),
  public.kpi_resultado(date, date)
  to authenticated;

-- Internos: los pedidos que cuentan como venta no se exponen sueltos a ningún cliente.
revoke all on function public._kpi_ventas(date, date) from public, anon, authenticated;

-- El reloj no revela datos, pero tampoco hace falta fuera de una sesión: se deja a
-- usuarios autenticados y al servidor.
revoke all on function public.dia_negocio(timestamptz), public._kpi_inicio(date) from public, anon;
grant execute on function public.dia_negocio(timestamptz), public._kpi_inicio(date) to authenticated, service_role;
