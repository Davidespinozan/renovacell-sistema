-- COBRO AL RECIBIR CON TERMINAL (23 nov 2026) · Alejandra eligió «Tarjeta (terminal)» pensando en que la clienta pagaría
-- con la terminal AL RECIBIR, el sistema lo tomó como «ya pagó» y al chofer le salió «Pagado · solo entregar».
-- 1) «Paga al recibir» guarda CÓMO va a pagar (efectivo | tarjeta | transferencia) para decírselo al chofer.
-- 2) El chofer también registra el cobro con TERMINAL (tarjeta), no solo efectivo o transferencia.
do $patch$
declare v text := pg_get_functiondef('public._venta_aplicar_cobro(uuid,jsonb,uuid)'::regprocedure);
  a1 constant text := '    v_metodo_pedido := ''contra_entrega'';';
begin
  if position(a1 in v) = 0 then raise exception 'AL-RECIBIR: _venta_aplicar_cobro cambió'; end if;
  execute replace(v, a1, a1 || '
    -- AL-RECIBIR · cómo va a pagar al recibir (lo ve el chofer): efectivo, terminal o transferencia.
    if coalesce(p_cobro ->> ''con'', '''') in (''efectivo'', ''tarjeta'', ''transferencia'') then
      perform set_config(''app.trusted'', ''on'', true);
      update public.orders set shipping_meta = coalesce(shipping_meta, ''{}''::jsonb) || jsonb_build_object(''cobro_al_recibir'', p_cobro ->> ''con'') where id = p_order;
      perform set_config(''app.trusted'', '''', true);
    end if;');
end $patch$;

do $patch$
declare v text := pg_get_functiondef('public.registrar_cobro_entrega(uuid,uuid,text,numeric,text)'::regprocedure);
  a1 constant text := 'if p_metodo is null or p_metodo not in (''efectivo'', ''transferencia'') then raise exception ''METODO_INVALIDO: efectivo o transferencia''';
begin
  if position(a1 in v) = 0 then raise exception 'AL-RECIBIR: registrar_cobro_entrega cambió'; end if;
  execute replace(v, a1, 'if p_metodo is null or p_metodo not in (''efectivo'', ''transferencia'', ''tarjeta'') then raise exception ''METODO_INVALIDO: efectivo, terminal o transferencia''');
end $patch$;
