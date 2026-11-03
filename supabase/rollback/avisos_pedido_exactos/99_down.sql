-- Reversa de 20270317120000_avisos_pedido_exactos.sql.
drop trigger if exists trg_aviso_pedido_nuevo on public.orders;
create trigger trg_aviso_pedido_nuevo after insert on public.orders for each row execute function public._aviso_pedido_nuevo();
do $d$
declare v text; i int; j int;
begin
  v := pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure);
  if position('select * into new from public.orders where id = new.id;' in v) > 0 then
    execute replace(v, '  select * into new from public.orders where id = new.id;   -- al confirmar: el pedido como quedó (total con envío)
  if not found or new.status <> ''pending_payment'' then return new; end if;', '  if new.status <> ''pending_payment'' then return new; end if;'); end if;
  v := pg_get_functiondef('public._cancelacion_avisos()'::regprocedure);
  i := position('  perform public._cc_notificar(''pedido_cancelado'', null, null, array[''admin''],' in v);
  if i > 0 then
    j := position('-- Dirección se entera de toda cancelación
' in v);
    execute substr(v, 1, i - 1) || substr(v, j + length('-- Dirección se entera de toda cancelación
'));
  end if;
end $d$;
