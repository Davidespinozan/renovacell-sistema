-- ============================================================================
-- AVISOS DE PEDIDO EXACTOS (ensayo E2E 2 nov 2026).
--   · "Nuevo pedido S… · $15,000 · por cobrar" salía con el total SIN el envío: el aviso se emitía al insertar el pedido y
--     el flete se suma después en la misma transacción. Ahora el aviso se emite al confirmar la transacción y lee el
--     pedido como quedó (total con envío, estado final: una venta que ya quedó pagada no avisa "por cobrar").
--   · Cuando el DOCTOR cancelaba, el aviso a Dirección se intentaba desde su navegador y la base lo rechazaba (correcto:
--     un doctor no escribe avisos): Dirección no se enteraba. Ahora el servidor avisa a Dirección de toda cancelación.
-- ============================================================================
do $d$
declare v text;
begin
  v := pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure);
  if position('declare v_seller uuid; v_txt text;
begin
  if new.status <> ''pending_payment'' then return new; end if;' in v) = 0 then raise exception 'AVISOS_EXACTOS: _aviso_pedido_nuevo cambió'; end if;
  execute replace(v, 'declare v_seller uuid; v_txt text;
begin
  if new.status <> ''pending_payment'' then return new; end if;', 'declare v_seller uuid; v_txt text;
begin
  select * into new from public.orders where id = new.id;   -- al confirmar: el pedido como quedó (total con envío)
  if not found or new.status <> ''pending_payment'' then return new; end if;');

  v := pg_get_functiondef('public._cancelacion_avisos()'::regprocedure);
  if position('  if new.return_id is not null then' in v) = 0 then raise exception 'AVISOS_EXACTOS: _cancelacion_avisos cambió'; end if;
  execute replace(v, '  if new.return_id is not null then', '  perform public._cc_notificar(''pedido_cancelado'', null, null, array[''admin''],
    ''Pedido '' || v_folio || '' cancelado'' || case new.actor_role when ''doctor'' then '' por el cliente'' when ''admin'' then '''' else '' por '' || new.actor_role end
      || coalesce('' · '' || nullif(btrim(new.reason), ''''), '''') || ''.'', ''av_ventas'', ''cancel_admin:'' || new.order_id::text);   -- Dirección se entera de toda cancelación
  if new.return_id is not null then');
end $d$;
drop trigger if exists trg_aviso_pedido_nuevo on public.orders;
create constraint trigger trg_aviso_pedido_nuevo after insert on public.orders deferrable initially deferred for each row execute function public._aviso_pedido_nuevo();
