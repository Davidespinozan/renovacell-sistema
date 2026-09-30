-- ============================================================================
-- W2-C · C3 — COMANDOS de custodia + extensiones QUIRÚRGICAS de W1/W2.
--
-- Todo lo que mueve custodia pasa por aquí. El frontend no escribe nada.
--
-- Extensiones autorizadas (y solo estas):
--   W1-X1  ajustar_lote   → piso de custodia en la baja
--   W1-X2  product_stock  → disponibilidad descuenta custodia + hoy_local()
--   W2-X1  vender_pos     → parámetro p_custody_id (una sola ruta económica)
--   W2-X2  surtir_pedido  → piso de custodia en la asignación
-- El kardex, inventory_operations, ck_invmov_reason, el libro de dinero, los
-- reembolsos, el crédito y el corte de caja quedan VERBATIM.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Registro de idempotencia (gemelo de los de W1 y W2)
-- ---------------------------------------------------------------------------
-- Mismo patrón que W1 y W2: el registro se ESCRIBE UNA SOLA VEZ al terminar. Así la
-- tabla es append-only de verdad (nunca se actualiza) y la llave primaria del op_id es
-- lo que resuelve una carrera entre dos intentos de la misma operación: el segundo
-- choca con el único y falla, no duplica.
create or replace function public._w2c_op_begin(p_op uuid, p_kind text, p_req jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_prev record;
begin
  if p_op is null then raise exception 'OP_ID_REQUERIDO: toda operación de custodia lleva identificador'; end if;
  select * into v_prev from public.custody_operations where op_id = p_op;
  if not found then return null; end if;
  if v_prev.kind <> p_kind or v_prev.request <> p_req then
    raise exception 'OP_ID_REUTILIZADO: ese identificador ya se usó con otros datos';
  end if;
  return coalesce(v_prev.result, '{}'::jsonb) || jsonb_build_object('status', 'already_applied');
end;
$$;

create or replace function public._w2c_op_finish(p_op uuid, p_kind text, p_req jsonb, p_result jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.custody_operations (op_id, kind, actor, actor_role, request, result)
  values (p_op, p_kind, auth.uid(), coalesce(public.auth_role(), ''), p_req, p_result);
  return p_result;
end;
$$;

create or replace function public._w2c_trusted(p_on boolean) returns void
  language sql security definer set search_path = public as
$$ select set_config('app.trusted', case when p_on then 'on' else 'off' end, true); $$;

revoke all on function public._w2c_op_begin(uuid, text, jsonb), public._w2c_op_finish(uuid, text, jsonb, jsonb),
  public._w2c_trusted(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) ABRIR CUSTODIA. El tenedor es una referencia estable (D-W2-C-7).
-- ---------------------------------------------------------------------------
create function public.abrir_custodia(
  p_op_id uuid, p_kind text, p_holder_kind text,
  p_holder_user_id uuid default null, p_holder_customer_id uuid default null,
  p_event_name text default null, p_event_venue text default null, p_event_date date default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección o Almacén abren una custodia';
  end if;
  v_req := jsonb_build_object('kind', p_kind, 'holder_kind', p_holder_kind, 'user', p_holder_user_id,
             'customer', p_holder_customer_id, 'event', p_event_name, 'venue', p_event_venue, 'date', p_event_date);
  v_prev := public._w2c_op_begin(p_op_id, 'custodia_abierta', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_kind not in ('evento','vendedor') then raise exception 'TIPO_INVALIDO: usa evento o vendedor'; end if;
  if p_holder_kind not in ('staff','doctor','tercero') then raise exception 'TENEDOR_INVALIDO: usa staff, doctor o tercero'; end if;
  if (p_holder_user_id is not null)::int + (p_holder_customer_id is not null)::int <> 1 then
    raise exception 'TENEDOR_REQUERIDO: indica EXACTAMENTE un tenedor (usuario del sistema o cliente del maestro)';
  end if;
  if p_holder_kind = 'staff' and p_holder_user_id is null then
    raise exception 'TENEDOR_INTERNO_REQUIERE_CUENTA: el personal interno se identifica con su usuario';
  end if;
  if p_holder_customer_id is not null
     and not exists (select 1 from public.customers where id = p_holder_customer_id and active) then
    raise exception 'CLIENTE_INEXISTENTE: el tenedor externo debe existir y estar activo en el maestro de clientes';
  end if;
  if p_holder_user_id is not null and not exists (select 1 from public.profiles where id = p_holder_user_id) then
    raise exception 'USUARIO_INEXISTENTE: el tenedor no tiene perfil';
  end if;
  if p_kind = 'evento' and nullif(btrim(p_event_name), '') is null then
    raise exception 'EVENTO_REQUIERE_NOMBRE';
  end if;
  if p_kind = 'vendedor' and p_event_name is not null then
    raise exception 'CONSIGNACION_SIN_EVENTO: una consignación de vendedor no lleva datos de evento';
  end if;
  if exists (select 1 from public.custodies c
              where c.kind = p_kind and c.status = 'abierta'
                and c.holder_user_id is not distinct from p_holder_user_id
                and c.holder_customer_id is not distinct from p_holder_customer_id) then
    raise exception 'CUSTODIA_YA_ABIERTA: ese tenedor ya tiene una custodia abierta de ese tipo';
  end if;

  insert into public.custodies (id, kind, holder_kind, holder_user_id, holder_customer_id,
                                event_name, event_venue, event_date, status, opened_by, op_id)
  values (p_op_id, p_kind, p_holder_kind, p_holder_user_id, p_holder_customer_id,
          nullif(btrim(p_event_name), ''), nullif(btrim(p_event_venue), ''), p_event_date,
          'abierta', auth.uid(), p_op_id);

  return public._w2c_op_finish(p_op_id, 'custodia_abierta', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_op_id, 'kind', p_kind));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) ENTREGAR A CUSTODIA (G-3). No mueve inventario, no genera COGS, ni revenue,
--    ni cuenta por cobrar: solo cambia de manos la responsabilidad. Lo único que
--    cambia es la DISPONIBILIDAD.
-- ---------------------------------------------------------------------------
create function public.entregar_custodia(p_op_id uuid, p_custody uuid, p_lines jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_falta record; v_n int := 0; v_u int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: solo Almacén o Dirección entregan producto en custodia';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'lines', p_lines);
  v_prev := public._w2c_op_begin(p_op_id, 'entrega', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ENTREGA_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: no se entrega a una custodia cerrada'; end if;

  -- a) renglón por renglón: cantidad válida, lote real y VIGENTE (hoy_local, D-W2-C-9).
  for v_ln in select x.lot_id, x.qty, l.id as existe, l.expiry_date, l.lot_code
                from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
                left join public.lots l on l.id = x.lot_id
  loop
    if v_ln.qty is null or v_ln.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    if v_ln.existe is null then raise exception 'LOTE_INEXISTENTE: %', v_ln.lot_id; end if;
    if public.lote_caducado(v_ln.expiry_date) then
      raise exception 'LOTE_CADUCADO: el lote % caducó el %; no se entrega en custodia', v_ln.lot_code, v_ln.expiry_date;
    end if;
  end loop;

  -- b) cerrojo de lotes en orden determinista (evita deadlock con surtido y POS).
  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int))
   order by id for update;

  -- c) tope AGREGADO por lote contra la DISPONIBILIDAD: dos renglones del mismo lote
  --    no pueden burlar el tope, y nunca se entrega lo que ya está en otra custodia.
  select f.lot_id, f.pedido, f.disponible into v_falta from (
    select x.lot_id, sum(x.qty)::int as pedido,
           (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = x.lot_id) as disponible
      from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
     group by x.lot_id) f
   where f.pedido > coalesce(f.disponible, 0)
   limit 1;
  if found then
    raise exception 'DISPONIBILIDAD_INSUFICIENTE: del lote % hay % disponibles y la entrega pide %',
      v_falta.lot_id, coalesce(v_falta.disponible, 0), v_falta.pedido;
  end if;

  -- d) el libro. NO se escribe inventory_movements y NO se toca lots.quantity (G-3):
  --    el producto sigue siendo nuestro, solo cambió de manos.
  insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                    actor, actor_role, op_id)
  select gen_random_uuid(), p_custody, 'entrega', l.product_id, x.lot_id, x.qty, x.qty,
         auth.uid(), coalesce(public.auth_role(), ''), p_op_id
    from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
    join public.lots l on l.id = x.lot_id;

  select count(*)::int, coalesce(sum(x.qty), 0)::int into v_n, v_u
    from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int);

  return public._w2c_op_finish(p_op_id, 'entrega', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody, 'renglones', v_n, 'unidades', v_u));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) PÉRDIDA (helper interno, G-5). UNA operación atómica: la línea del libro y la
--    BAJA REAL de inventario por la autoridad canónica de W1 (ajustar_lote). Nunca
--    queda una "merma pendiente" que alguien pueda olvidar.
--
--    ORDEN IMPORTANTE: primero la línea (que baja `custody_held`), después la baja.
--    Así el piso de custodia de W1-X1 ya bajó y la baja pasa sin excepciones ni
--    banderas: una sola semántica de disponibilidad para todos.
--
--    Físicamente toda pérdida es una merma (vocabulario de W1 intacto); la CAUSA
--    —faltante, daño o caducidad— vive en el libro de custodia.
--    NO genera deuda, ni claim, ni asiento (D-W2-C-4).
-- ---------------------------------------------------------------------------
create function public._w2c_perdida(
  p_custody uuid, p_kind text, p_lot uuid, p_qty int, p_motivo text, p_evidencia text, p_op_id uuid
) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_inv uuid := gen_random_uuid(); v_prod uuid; v_en_poder int; v_line uuid := gen_random_uuid();
begin
  if p_qty is null or p_qty <= 0 then raise exception 'CANTIDAD_INVALIDA: la pérdida debe ser mayor a cero'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: toda pérdida lleva motivo'; end if;
  select product_id into v_prod from public.lots where id = p_lot;
  if v_prod is null then raise exception 'LOTE_INEXISTENTE: %', p_lot; end if;

  v_en_poder := public.custody_held_en(p_custody, p_lot);
  if p_qty > v_en_poder then
    raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % hay % en poder y se reportan % perdidas',
      p_lot, v_en_poder, p_qty;
  end if;

  insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                    inventory_op_id, motivo, evidence_ref, actor, actor_role, op_id)
  values (v_line, p_custody, p_kind, v_prod, p_lot, p_qty, -p_qty,
          v_inv, left(btrim(p_motivo), 400), nullif(btrim(p_evidencia), ''),
          auth.uid(), coalesce(public.auth_role(), ''), p_op_id);

  -- Baja real por W1 (su kardex, su registro de operaciones, sus invariantes).
  perform public.ajustar_lote(v_inv, p_lot, -p_qty, 'merma',
    format('custodia %s · %s · %s', p_custody, p_kind, btrim(p_motivo)));
  return v_line;
end;
$$;
revoke all on function public._w2c_perdida(uuid, text, uuid, int, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) DEVOLVER DE CUSTODIA. La devolución LIMPIA no mueve inventario (las unidades
--    nunca dejaron de ser nuestras): solo vuelven a estar disponibles. Lo que llega
--    dañado o vencido se registra como pérdida en el MISMO acto.
-- ---------------------------------------------------------------------------
create function public.devolver_de_custodia(p_op_id uuid, p_custody uuid, p_lines jsonb, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_insp text;
  v_ok int := 0; v_perdido int := 0; v_en_poder int;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: la devolución la recibe Almacén (o Dirección)';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'lines', p_lines, 'motivo', p_motivo);
  v_prev := public._w2c_op_begin(p_op_id, 'devolucion', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'DEVOLUCION_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;

  for v_ln in select x.lot_id, x.qty, coalesce(x.inspection, '') as inspection
                from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text)
  loop
    if v_ln.qty is null or v_ln.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    v_insp := v_ln.inspection;
    if v_insp = '' then
      raise exception 'INSPECCION_REQUERIDA: indica si el producto llegó bien, dañado o caducado';
    end if;
    if v_insp not in ('ok','dañado','caducado') then
      raise exception 'INSPECCION_INVALIDA: usa ok, dañado o caducado';
    end if;

    -- Un lote CADUCADO no vuelve a estar disponible aunque llegue íntegro
    -- (D-W2-C-9): se reclasifica como caducado y se da de baja.
    if v_insp = 'ok'
       and public.lote_caducado((select expiry_date from public.lots where id = v_ln.lot_id)) then
      v_insp := 'caducado';
    end if;

    if v_insp = 'ok' then
      v_en_poder := public.custody_held_en(p_custody, v_ln.lot_id);
      if v_ln.qty > v_en_poder then
        raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % hay % en poder y se devuelven %',
          v_ln.lot_id, v_en_poder, v_ln.qty;
      end if;
      insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                        actor, actor_role, op_id)
      select gen_random_uuid(), p_custody, 'devolucion', l.product_id, v_ln.lot_id, v_ln.qty, -v_ln.qty,
             auth.uid(), coalesce(public.auth_role(), ''), p_op_id
        from public.lots l where l.id = v_ln.lot_id;
      v_ok := v_ok + v_ln.qty;
    else
      perform public._w2c_perdida(p_custody,
        case when v_insp = 'caducado' then 'caducado' else 'merma' end,
        v_ln.lot_id, v_ln.qty,
        coalesce(nullif(btrim(p_motivo), ''), 'Devuelto ' || v_insp), null, p_op_id);
      v_perdido := v_perdido + v_ln.qty;
    end if;
  end loop;

  return public._w2c_op_finish(p_op_id, 'devolucion', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody,
                       'devuelto_disponible', v_ok, 'dado_de_baja', v_perdido));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) REGISTRAR PÉRDIDA (faltante / merma / caducado) — Almacén o Dirección, con
--    motivo y evidencia. El tenedor NO registra sus propias pérdidas: quien las
--    verifica físicamente las asienta (misma disciplina que la merma de W1).
-- ---------------------------------------------------------------------------
create function public.registrar_perdida_custodia(
  p_op_id uuid, p_custody uuid, p_kind text, p_lines jsonb, p_motivo text, p_evidencia text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_u int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: solo Almacén o Dirección registran una pérdida de custodia';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'kind', p_kind, 'lines', p_lines,
             'motivo', p_motivo, 'evidencia', p_evidencia);
  v_prev := public._w2c_op_begin(p_op_id, 'perdida', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_kind not in ('faltante','merma','caducado') then
    raise exception 'TIPO_INVALIDO: usa faltante, merma o caducado';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: toda pérdida lleva motivo'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PERDIDA_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;

  for v_ln in select x.lot_id, x.qty from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int) loop
    perform public._w2c_perdida(p_custody, p_kind, v_ln.lot_id, v_ln.qty, p_motivo, p_evidencia, p_op_id);
    v_u := v_u + v_ln.qty;
  end loop;

  return public._w2c_op_finish(p_op_id, 'perdida', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody, 'kind', p_kind, 'unidades', v_u,
                       'nota', 'Pérdida de inventario de la empresa. NO genera deuda del tenedor.'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) CERRAR CUSTODIA. Exige saldo CERO en poder: todo lo entregado se vendió, se
--    devolvió o se dio de baja. La liquidación es un ESTADO (v_custody_liquidacion),
--    no un evento de dinero: el dinero ya nació en cada venta (G-4).
-- ---------------------------------------------------------------------------
create function public.cerrar_custodia(p_op_id uuid, p_custody uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_cus record; v_pend record; v_liq record;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección cierra y liquida una custodia';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'motivo', p_motivo);
  v_prev := public._w2c_op_begin(p_op_id, 'custodia_cerrada', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;

  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status = 'cerrada' then
    return public._w2c_op_finish(p_op_id, 'custodia_cerrada', v_req,
      jsonb_build_object('status', 'already_closed', 'custody_id', p_custody));
  end if;

  select s.lot_id, s.en_poder into v_pend from public.v_custody_stock s
   where s.custody_id = p_custody and s.en_poder <> 0 limit 1;
  if found then
    raise exception 'CUSTODIA_CON_SALDO: el lote % tiene % unidades en poder; devuélvelas o regístralas como pérdida antes de cerrar',
      v_pend.lot_id, v_pend.en_poder;
  end if;

  perform public._w2c_trusted(true);
  update public.custodies
     set status = 'cerrada', closed_at = now(), closed_by = auth.uid(), close_reason = left(btrim(p_motivo), 400)
   where id = p_custody;
  perform public._w2c_trusted(false);

  select * into v_liq from public.v_custody_liquidacion where custody_id = p_custody;
  return public._w2c_op_finish(p_op_id, 'custodia_cerrada', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody,
                       'entregadas', v_liq.unidades_entregadas, 'vendidas', v_liq.unidades_vendidas,
                       'devueltas', v_liq.unidades_devueltas, 'perdidas', v_liq.unidades_perdidas,
                       'importe_vendido', v_liq.importe_vendido, 'cobrado', v_liq.cobrado, 'saldo', v_liq.saldo));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) CONSULTAS
-- ---------------------------------------------------------------------------
create function public.estado_custodia(p_custody uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_c record; v_l record;
begin
  select * into v_c from public.custodies where id = p_custody;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if not (public.auth_role() = any (array['admin','billing','warehouse','packing'])
          or v_c.holder_user_id = auth.uid()) then
    raise exception 'NO_AUTORIZADO';
  end if;
  select * into v_l from public.v_custody_liquidacion where custody_id = p_custody;
  return to_jsonb(v_l) || jsonb_build_object(
    'kind', v_c.kind, 'status', v_c.status, 'holder_kind', v_c.holder_kind,
    'event_name', v_c.event_name, 'opened_at', v_c.opened_at, 'closed_at', v_c.closed_at,
    'saldos', coalesce((select jsonb_agg(jsonb_build_object('product_id', s.product_id, 'lot_id', s.lot_id,
                                'entregado', s.entregado, 'vendido', s.vendido, 'devuelto', s.devuelto,
                                'perdido', s.perdido, 'en_poder', s.en_poder))
                          from public.v_custody_stock s where s.custody_id = p_custody and s.en_poder <> 0), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'lot_id', l.lot_id,
                                'qty', l.qty, 'motivo', l.motivo, 'order_id', l.order_id, 'created_at', l.created_at)
                              order by l.created_at)
                              from public.custody_lines l where l.custody_id = p_custody), '[]'::jsonb));
end;
$$;

-- Recuperación ante respuesta AMBIGUA (red/timeout): ¿el servidor ya la registró?
create function public.estado_operacion_custodia(p_op_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select result || jsonb_build_object('status', 'already_applied')
    from public.custody_operations
   where op_id = p_op_id and (actor = auth.uid() or public.auth_role() = any (array['admin','warehouse','packing']));
$$;

-- ---------------------------------------------------------------------------
-- 8) CONCILIACIÓN de custodia (E1–E9). Dirección.
-- ---------------------------------------------------------------------------
create function public.conciliar_custodia()
returns table (check_id text, severidad text, entidad text, entidad_id uuid, detalle text, esperado numeric, obtenido numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  -- E1: nadie puede tener menos de cero en poder
  select 'E1_en_poder_negativo', 'error', 'custody', s.custody_id,
         'lote ' || s.lot_id::text, 0::numeric, s.en_poder::numeric
    from public.v_custody_stock s where s.en_poder < 0
  union all
  -- E2: la custodia total de un lote no puede exceder la existencia propia
  select 'E2_custodia_excede_propio', 'error', 'lot', d.lot_id,
         d.lot_code, d.propio::numeric, d.en_custodia::numeric
    from public.v_stock_disponible d where d.en_custodia > d.propio
  union all
  -- E3: toda venta de custodia tiene su movimiento 'venta' del MISMO lote y cantidad
  select 'E3_venta_sin_movimiento', 'error', 'custody_line', l.id,
         'lote ' || l.lot_id::text || ' · ' || l.qty::text, l.qty::numeric,
         coalesce((select sum(-m.change) from public.inventory_movements m
                    where m.order_item_id = l.order_item_id and m.lot_id = l.lot_id and m.reason = 'venta'), 0)::numeric
    from public.custody_lines l where l.kind = 'venta'
     and coalesce((select sum(-m.change) from public.inventory_movements m
                    where m.order_item_id = l.order_item_id and m.lot_id = l.lot_id and m.reason = 'venta'), 0) <> l.qty
  union all
  -- E4: venta de custodia sin realidad económica (ni cobro ni crédito autorizado)
  select 'E4_venta_sin_dinero', 'error', 'order', om.order_id,
         coalesce(om.external_ref, ''), om.total, om.cobrado_neto
    from public.v_order_money om
   where om.order_id in (select distinct l.order_id from public.custody_lines l where l.kind = 'venta')
     and om.cobrado_neto <= 0 and not om.credito_autorizado
  union all
  -- E5: custodia cerrada con saldo en poder
  select 'E5_cerrada_con_saldo', 'error', 'custody', s.custody_id,
         'lote ' || s.lot_id::text, 0::numeric, s.en_poder::numeric
    from public.v_custody_stock s
    join public.custodies c on c.id = s.custody_id
   where c.status = 'cerrada' and s.en_poder <> 0
  union all
  -- E6: salida (venta/devolución/pérdida) de un lote que nunca se entregó a esa custodia
  select 'E6_lote_no_entregado', 'error', 'custody_line', l.id,
         'lote ' || l.lot_id::text, null::numeric, null::numeric
    from public.custody_lines l
   where l.kind <> 'entrega'
     and not exists (select 1 from public.custody_lines e
                      where e.custody_id = l.custody_id and e.lot_id = l.lot_id and e.kind = 'entrega')
  union all
  -- E7: lotes VENCIDOS (o por vencer en 30 días) todavía en poder de alguien
  select case when public.lote_caducado(d.expiry_date) then 'E7_caducado_en_custodia' else 'E7_por_caducar_en_custodia' end,
         case when public.lote_caducado(d.expiry_date) then 'error' else 'alerta' end,
         'custody', s.custody_id,
         d.lot_code || ' · vence ' || d.expiry_date::text, null::numeric, s.en_poder::numeric
    from public.v_custody_stock s
    join public.v_stock_disponible d on d.lot_id = s.lot_id
    join public.custodies c on c.id = s.custody_id
   where s.en_poder > 0 and c.status = 'abierta'
     and d.expiry_date is not null and d.expiry_date <= public.hoy_local() + 30
  union all
  -- E8: pérdida sin su baja real de inventario
  select 'E8_perdida_sin_baja', 'error', 'custody_line', l.id,
         l.kind || ' · lote ' || l.lot_id::text, l.qty::numeric,
         coalesce((select sum(-m.change) from public.inventory_movements m
                    where m.op_id = l.inventory_op_id and m.lot_id = l.lot_id and m.reason = 'merma'), 0)::numeric
    from public.custody_lines l where l.kind in ('faltante','merma','caducado')
     and coalesce((select sum(-m.change) from public.inventory_movements m
                    where m.op_id = l.inventory_op_id and m.lot_id = l.lot_id and m.reason = 'merma'), 0) <> l.qty
  union all
  -- E9: una pérdida NUNCA debe haber generado dinero ni deuda (D-W2-C-4)
  select 'E9_perdida_con_dinero', 'error', 'custody_line', l.id,
         'la pérdida no puede generar cobro ni reembolso', 0::numeric, 1::numeric
    from public.custody_lines l
   where l.kind in ('faltante','merma','caducado') and l.order_id is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) W1-X2 · product_stock: la disponibilidad que ve el cliente descuenta custodia.
--    Además la caducidad pasa a hoy_local() (zona del negocio), coherente con
--    lote_caducado() de W1 — antes usaba current_date (UTC) y la frontera caía a
--    media tarde en México.
--    Los 4 consumidores (catálogo del doctor, asistente, caja POS, reabastecimiento)
--    quedan corregidos de un solo golpe porque todos beben de esta vista.
-- ---------------------------------------------------------------------------
create or replace view public.product_stock as
  select l.product_id,
         coalesce(sum(greatest(l.quantity - public.custody_held(l.id), 0)), 0)::int as available
    from public.lots l
   where l.product_id is not null
     and not public.lote_caducado(l.expiry_date)
     and (public.auth_role() <> 'doctor' or public.is_verified())
   group by l.product_id;
revoke all on public.product_stock from anon, public;
grant select on public.product_stock to authenticated;
comment on view public.product_stock is
  'Disponibilidad por PRODUCTO: existencia propia no caducada MENOS lo que está en custodia. Autoridad de lo que se puede prometer y vender.';

-- ============================================================================
-- EXTENSIONES QUIRÚRGICAS. Cada función se reemplaza VERBATIM salvo el cambio
-- autorizado, que va comentado en su lugar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- W1-X1 · ajustar_lote: la baja no puede comerse las unidades en custodia.
-- ---------------------------------------------------------------------------
create or replace function public.ajustar_lote(
  p_op_id      uuid,
  p_lot        uuid,
  p_delta      integer,
  p_kind       text,              -- merma | ajuste | correccion_recepcion
  p_reason     text,
  p_receipt_id uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_lot record; v_rc record; v_rep record; v_corr int; v_new_rec int; v_new_status text;
begin
  if p_kind is null or p_kind not in ('merma','ajuste','correccion_recepcion') then
    raise exception 'TIPO_AJUSTE_INVALIDO: usa merma, ajuste o correccion_recepcion';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'CANTIDAD_INVALIDA: el ajuste no puede ser cero'; end if;
  if p_kind = 'merma' and p_delta > 0 then raise exception 'MERMA_DEBE_SER_NEGATIVA: una merma solo da de baja'; end if;
  if p_kind = 'correccion_recepcion' and p_delta > 0 then
    raise exception 'CORRECCION_DEBE_SER_NEGATIVA: si faltó capturar, registra otra recepción';
  end if;
  if p_delta > 0 or p_kind = 'correccion_recepcion' then
    if v_role <> 'admin' then
      raise exception 'NO_AUTORIZADO: % positivo/corrección de recepción requiere Dirección', p_kind;
    end if;
  elsif not (v_role = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para dar de baja inventario';
  end if;

  v_req := jsonb_build_object('lot', p_lot, 'delta', p_delta, 'kind', p_kind, 'reason', p_reason, 'receipt', p_receipt_id);
  v_prev := public._w1_op_begin(p_op_id, 'ajuste', v_req);
  if v_prev is not null then return v_prev; end if;

  if nullif(btrim(p_reason), '') is null then raise exception 'MOTIVO_REQUERIDO: toda baja/ajuste requiere motivo'; end if;
  if p_lot is null then raise exception 'LOTE_REQUERIDO'; end if;
  select * into v_lot from public.lots where id = p_lot for update;
  if not found then raise exception 'LOTE_INEXISTENTE'; end if;

  if p_kind = 'correccion_recepcion' then
    if p_receipt_id is null then raise exception 'RECEPCION_REQUERIDA: la corrección se liga a su recepción'; end if;
    select * into v_rc from public.purchase_receipts where id = p_receipt_id;
    if not found then raise exception 'RECEPCION_INEXISTENTE'; end if;
    if v_rc.lot_id <> p_lot then raise exception 'RECEPCION_DE_OTRO_LOTE'; end if;
    select coalesce(sum(-change), 0) into v_corr from public.inventory_movements
     where receipt_id = p_receipt_id and reason = 'correccion_recepcion';
    if v_corr + (-p_delta) > v_rc.qty then
      raise exception 'CORRECCION_EXCEDE_RECEPCION: recibido %, ya corregido %, solicitado %', v_rc.qty, v_corr, -p_delta;
    end if;
    if v_rc.kind = 'orden' then
      select * into v_rep from public.replenishments where id = v_rc.replenishment_id for update;
      v_new_rec := v_rep.received_qty - (-p_delta);
      v_new_status := case
        when v_rep.status in ('recibida','cerrada_incompleta') then 'cerrada_incompleta'  -- nunca se reabre
        when v_new_rec = 0 then 'pendiente'
        else 'parcial' end;
      perform public._w1_trusted(true);
      update public.replenishments
         set received_qty = v_new_rec,
             status       = v_new_status,
             closed_by    = case when v_rep.status = 'recibida' then v_uid else closed_by end,
             closed_at    = case when v_rep.status = 'recibida' then now() else closed_at end,
             close_reason = case when v_rep.status = 'recibida' then 'Corrección de recepción: ' || btrim(p_reason) else close_reason end
       where id = v_rep.id;
      perform public._w1_trusted(false);
    end if;
  elsif p_receipt_id is not null then
    raise exception 'RECEPCION_NO_APLICA: solo la corrección de recepción referencia una recepción';
  end if;

  if p_delta < 0 then
    -- W2-C · W1-X1: la baja no puede comerse las unidades que están EN CUSTODIA.
    -- El piso es la existencia en poder de algún tenedor: esas unidades no están en
    -- el almacén y solo salen por el comando de pérdida de custodia (que registra la
    -- línea ANTES de llamar aquí, así que para él el piso ya bajó).
    update public.lots set quantity = quantity + p_delta
     where id = p_lot and quantity + p_delta >= public.custody_held(p_lot);
    if not found then
      if v_lot.quantity + p_delta >= 0 then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; solo hay % disponibles para dar de baja',
          v_lot.lot_code, public.custody_held(p_lot), v_lot.quantity - public.custody_held(p_lot);
      end if;
      raise exception 'INVENTARIO_INSUFICIENTE: el lote % tiene % y la baja es de %', v_lot.lot_code, v_lot.quantity, -p_delta;
    end if;
  else
    update public.lots set quantity = quantity + p_delta where id = p_lot;
  end if;

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, receipt_id)
  values (p_lot, p_delta, p_kind, btrim(p_reason), v_uid, p_op_id, p_receipt_id);

  v_res := jsonb_build_object('status', 'applied', 'lot_id', p_lot, 'delta', p_delta, 'kind', p_kind,
             'quantity', v_lot.quantity + p_delta);
  return public._w1_op_finish(p_op_id, 'ajuste', v_req, v_res);
end;
$$;
-- ---------------------------------------------------------------------------
-- W2-X2 · surtir_pedido: se asigna contra la DISPONIBILIDAD, no contra lo propio.
-- ---------------------------------------------------------------------------
create or replace function public.surtir_pedido(p_op_id uuid, p_order uuid, p_allocations jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_ord record; a record; v_bad int; v_items int;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para surtir';
  end if;
  v_req := jsonb_build_object('order', p_order, 'allocations', p_allocations);
  v_prev := public._w1_op_begin(p_op_id, 'surtido', v_req);
  if v_prev is not null then return v_prev; end if;

  select id, status, external_ref into v_ord from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if v_ord.status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = p_order) then
    raise exception 'PEDIDO_CANCELADO: no se surte un pedido cancelado';
  end if;
  if v_ord.status in ('packed','shipped','delivered','fulfilled') then
    raise exception 'PEDIDO_YA_SURTIDO: el pedido ya está %', v_ord.status;
  end if;
  -- W2 · F-7: se surte lo LIBERADO, no lo "marcado como pagado". Un pedido a crédito
  -- se surte con payment_status='pending' y sin tocar orders.status.
  if not public.pedido_liberado_para_surtir(p_order) then
    raise exception 'PEDIDO_NO_LIBERADO: el pedido no tiene cobro suficiente ni crédito autorizado';
  end if;
  if v_ord.status not in ('pending_payment','paid','picking') then
    raise exception 'PEDIDO_NO_SURTIBLE: el pedido está %', v_ord.status;
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  select count(*) into v_items from public.order_items where order_id = p_order;
  if v_items = 0 then raise exception 'PEDIDO_SIN_RENGLONES: no hay nada que surtir'; end if;

  -- a) cada asignación: renglón del pedido, qty > 0, lote del mismo producto, vigente
  for a in
    select x.order_item_id, x.lot_id, x.qty, oi.product_id as item_product, l.product_id as lot_product, l.expiry_date
      from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
      left join public.order_items oi on oi.id = x.order_item_id and oi.order_id = p_order
      left join public.lots l on l.id = x.lot_id
  loop
    if a.item_product is null then raise exception 'ASIGNACION_INVALIDA: el renglón % no pertenece al pedido', a.order_item_id; end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.item_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;

  -- b) cobertura exacta: Σ asignado por renglón = cantidad del renglón (todo o nada)
  select count(*) into v_bad
    from public.order_items oi
    left join (select x.order_item_id, sum(x.qty) s
                 from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
                group by 1) s on s.order_item_id = oi.id
   where oi.order_id = p_order and coalesce(s.s, 0) <> oi.qty;
  if v_bad > 0 then
    raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad pedida', v_bad;
  end if;

  -- c) locks de lotes en orden determinista (evita deadlocks entre surtidos)
  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int))
   order by id for update;

  -- d) descuento condicional + kardex con referencia de negocio
  for a in select x.order_item_id, x.lot_id, x.qty
             from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
  loop
    -- W2-C · W2-X2: se asigna contra la DISPONIBILIDAD, no contra la existencia propia.
    -- Las unidades en custodia están físicamente con un vendedor o en un evento: el
    -- almacén no puede prometerlas ni surtirlas.
    update public.lots set quantity = quantity - a.qty
     where id = a.lot_id and quantity - a.qty >= public.custody_held(a.lot_id);
    if not found then
      if exists (select 1 from public.lots l where l.id = a.lot_id and l.quantity >= a.qty) then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; disponibles %',
          a.lot_id, public.custody_held(a.lot_id),
          (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = a.lot_id);
      end if;
      raise exception 'INVENTARIO_INSUFICIENTE: el lote % no alcanza', a.lot_id;
    end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'surtido', coalesce(v_ord.external_ref, p_order::text), v_uid, p_op_id, p_order, a.order_item_id);
  end loop;

  -- e) empacado (solo por comando) + lote de referencia por renglón (dato de pantalla)
  perform public._w1_trusted(true);
  update public.orders set status = 'packed' where id = p_order;
  perform public._w1_trusted(false);
  update public.order_items oi set lot_id = f.lot_id
    from (select distinct on ((e.j ->> 'order_item_id')::uuid)
                 (e.j ->> 'order_item_id')::uuid as order_item_id, (e.j ->> 'lot_id')::uuid as lot_id
            from jsonb_array_elements(p_allocations) with ordinality as e(j, n)
           order by (e.j ->> 'order_item_id')::uuid, e.n) f
   where oi.id = f.order_item_id;

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'order_status', 'packed',
             'allocations', jsonb_array_length(p_allocations));
  return public._w1_op_finish(p_op_id, 'surtido', v_req, v_res);
end;
$$;
-- ---------------------------------------------------------------------------
-- W2-X1 · vender_pos: venta DESDE CUSTODIA por la misma ruta económica.
-- La firma cambia (un parámetro más), así que la anterior se ELIMINA: el frontend
-- viejo falla cerrado en vez de vender por una ruta sin custodia.
-- ---------------------------------------------------------------------------
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric);
create or replace function public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text,
  p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb,
  p_invoice_requested boolean default false, p_invoice_meta jsonb default null::jsonb, p_customer_id uuid default null::uuid,
  p_efectivo_recibido numeric default null,
  -- W2-C · W2-X1: venta DESDE CUSTODIA por la MISMA ruta económica. Sin este
  -- parámetro el comportamiento es idéntico al de siempre (venta de mostrador).
  p_custody_id uuid default null)
returns boolean
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
  v_cus record; v_falta record;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id,
             'custody', p_custody_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  if p_customer_id is not null then
    select full_name, phone into v_cname, v_cphone from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'PEDIDO_EXISTENTE: el id % ya pertenece a otro pedido', p_order_id;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  v_nlines := jsonb_array_length(p_lines);
  v_metodo := case when p_payment_method in ('efectivo','tarjeta','transferencia','stripe') then p_payment_method else 'otro' end;

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  for a in
    select x.line_index, x.lot_id, x.qty, l.product_id as lot_product, l.expiry_date,
           nullif(p_lines -> x.line_index ->> 'product_id', '')::uuid as line_product
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      left join public.lots l on l.id = x.lot_id
  loop
    if a.line_index is null or a.line_index < 0 or a.line_index >= v_nlines then
      raise exception 'ASIGNACION_INVALIDA: renglón % inexistente', a.line_index;
    end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.line_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;
  select count(*) into v_bad
    from generate_series(0, v_nlines - 1) g(i)
    left join (select x.line_index, sum(x.qty) s from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
                group by 1) s on s.line_index = g.i
   where coalesce(s.s, 0) <> (p_lines -> g.i ->> 'qty')::int;
  if v_bad > 0 then raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad vendida', v_bad; end if;

  -- W2-C · VENTA DESDE CUSTODIA. Todo lo anterior (precio del servidor, lote vigente,
  -- asignaciones completas) ya se validó igual que en mostrador; aquí solo se añade lo
  -- propio de la custodia. El cerrojo de la custodia serializa dos ventas simultáneas
  -- del mismo saldo.
  if p_custody_id is not null then
    select * into v_cus from public.custodies where id = p_custody_id for update;
    if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
    if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;
    if not (public.auth_role() = 'admin' or v_cus.holder_user_id = v_uid) then
      raise exception 'NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella';
    end if;
    -- Cada lote asignado tiene que estar EN PODER de esa custodia, y alcanzar.
    -- Se agrega por lote: una venta puede partir un renglón en dos lotes y dos
    -- renglones pueden tocar el mismo lote.
    select x.lot_id, sum(x.qty)::int as pedido, public.custody_held_en(p_custody_id, x.lot_id) as en_poder
      into v_falta
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
     group by x.lot_id
    having sum(x.qty) > public.custody_held_en(p_custody_id, x.lot_id)
     limit 1;
    if found then
      raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % tienes % y la venta pide %',
        v_falta.lot_id, v_falta.en_poder, v_falta.pedido;
    end if;
  end if;

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  -- El POS cobra al momento: payment_status='paid' queda respaldado por el asiento de abajo.
  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty))
    returning id into v_item;
    v_items := v_items || v_item;
  end loop;

  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int))
   order by id for update;

  -- W2-C: el libro de custodia se escribe ANTES del descuento. Así `custody_held` ya
  -- refleja que esas unidades dejaron de estar en poder del tenedor y el descuento de
  -- abajo usa EXACTAMENTE la misma condición que una venta de mostrador: una sola
  -- semántica de disponibilidad, sin excepciones ni banderas.
  if p_custody_id is not null then
    insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                      unit_price, order_id, order_item_id, actor, actor_role, op_id)
    select gen_random_uuid(), p_custody_id, 'venta', l.product_id, x.lot_id, x.qty, -x.qty,
           public.precio_de(l.product_id, null, (p_lines -> x.line_index ->> 'qty')::int),
           p_order_id, v_items[x.line_index + 1], v_uid, coalesce(public.auth_role(), ''), p_order_id
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      join public.lots l on l.id = x.lot_id;
  end if;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    -- W2-C · W2-X1: se descuenta contra la DISPONIBILIDAD (propio − en custodia).
    update public.lots set quantity = quantity - a.qty
     where id = a.lot_id and quantity - a.qty >= public.custody_held(a.lot_id);
    if not found then
      if exists (select 1 from public.lots l where l.id = a.lot_id and l.quantity >= a.qty) then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; disponibles %',
          a.lot_id, public.custody_held(a.lot_id),
          (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = a.lot_id);
      end if;
      raise exception 'Inventario insuficiente en el lote %', a.lot_id;
    end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'venta', p_folio, v_uid, p_order_id, p_order_id, v_items[a.line_index + 1]);
  end loop;

  -- W2 · F-1: el cobro de mostrador nace como ASIENTO en el libro, en esta misma
  -- transacción. El efectivo recibido queda como evidencia para el corte de caja.
  perform public._w2_asiento(gen_random_uuid(), p_order_id, 'in', v_metodo, tot, public.hoy_local(),
    null, null, null, null,
    case when v_metodo = 'efectivo' and p_efectivo_recibido is not null
         then format('recibido=%s;cambio=%s', p_efectivo_recibido, p_efectivo_recibido - tot) end);

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$$;
-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke all on function
  public.abrir_custodia(uuid, text, text, uuid, uuid, text, text, date),
  public.entregar_custodia(uuid, uuid, jsonb),
  public.devolver_de_custodia(uuid, uuid, jsonb, text),
  public.registrar_perdida_custodia(uuid, uuid, text, jsonb, text, text),
  public.cerrar_custodia(uuid, uuid, text),
  public.estado_custodia(uuid),
  public.estado_operacion_custodia(uuid),
  public.conciliar_custodia(),
  public.custody_held(uuid),
  public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid)
  from public, anon;

grant execute on function
  public.abrir_custodia(uuid, text, text, uuid, uuid, text, text, date),
  public.entregar_custodia(uuid, uuid, jsonb),
  public.devolver_de_custodia(uuid, uuid, jsonb, text),
  public.registrar_perdida_custodia(uuid, uuid, text, jsonb, text, text),
  public.cerrar_custodia(uuid, uuid, text),
  public.estado_custodia(uuid),
  public.estado_operacion_custodia(uuid),
  public.conciliar_custodia(),
  public.custody_held(uuid),
  public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid)
  to authenticated, service_role;
