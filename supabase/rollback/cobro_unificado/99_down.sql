-- Reversa de 20270407500000_cobro_unificado.sql (COBRO-U · 23 nov 2026). Vuelve a SEC-B (solo Dirección/Facturación cobra).
do $d$
declare v text;
begin
  v := pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure);
  v := replace(v, '  -- COBRO-U (23 nov 2026, dueño): Ventas también cobra, solo sus ventas (_venta_puede_cobrar).',
                  '  -- SEC-B · D-SEC-1: POS cobra SOLO dentro de vender_pos; nunca registra cobros sobre pedidos existentes.');
  v := replace(v, '  if not (v_srv or public._venta_puede_cobrar(p_order)) then','  if not (v_srv or public.auth_role() = any (array[''admin'',''billing''])) then');
  v := regexp_replace(v, '\n  -- COBRO-U · el vendedor no cobra.*?\n  end if;', '', 's');
  execute v;

  v := pg_get_functiondef('public.autorizar_credito(uuid,uuid,date,text)'::regprocedure);
  v := regexp_replace(v, '  -- COBRO-U · Dirección o el vendedor.*?\n  end if;', '  if public.auth_role() <> ''admin'' then
    raise exception ''NO_AUTORIZADO: solo Dirección autoriza crédito'';
  end if;', 's');
  v := regexp_replace(v, '\n  if p_due_date > public.hoy_local\(\) \+ 180 then[^\n]*', '');
  v := regexp_replace(v, '\n  -- COBRO-U · si no lo dio Dirección.*?\n    end;\n  end if;', '', 's');
  execute v;

  v := pg_get_functiondef('public.link_pago_pagado(uuid,text)'::regprocedure);
  v := regexp_replace(v, '  -- COBRO-U · también el vendedor de la venta\.\n[^\n]*', '  if not (public.auth_role() = any (array[''admin'', ''billing''])) then raise exception ''NO_AUTORIZADO: el cobro lo registran Dirección o Facturación'' using errcode = ''insufficient_privilege''; end if;');
  execute v;

  v := pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure);
  v := regexp_replace(v, '  v_txt := format\(''Nuevo pedido %s · %s · %s''.*?-- COBRO-U', '  v_txt := format(''Nuevo pedido %s · %s · por cobrar'', coalesce(new.external_ref, ''sin folio''), to_char(coalesce(new.total, 0), ''FM$999,999,990.00''));', 's');
  execute v;

  v := pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure);
  v := replace(v, '
  v_cred_vence date; v_cred_motivo text; v_cobro_ref text;   -- COBRO-U', '');
  v := regexp_replace(v, '  v_metodo := case when p_payment_method in \(''efectivo'',''tarjeta'',''transferencia'',''stripe'',''credito''\).*?Crédito en mostrador''\);\n  end if;',
    '  v_metodo := case when p_payment_method in (''efectivo'',''tarjeta'',''transferencia'',''stripe'') then p_payment_method else ''otro'' end;', 's');
  v := replace(v, '
  v_meta := v_meta - ''cobro'';   -- COBRO-U · los datos del cobro van al libro, no al pedido', '');
  v := replace(v, '''delivered'', p_payment_method, case when v_metodo = ''credito'' then ''pending'' else ''paid'' end,', '''delivered'', p_payment_method, ''paid'',');
  v := regexp_replace(v, '  if v_metodo = ''credito'' then\n    -- COBRO-U · venta a crédito.*?  else\n  perform public._w2_asiento', '  perform public._w2_asiento', 's');
  v := replace(v, '    null, null, v_cobro_ref, null,', '    null, null, null, null,');
  v := replace(v, 'p_efectivo_recibido - tot) end);
  end if;', 'p_efectivo_recibido - tot) end);');
  execute v;
end $d$;

drop function if exists public.crear_pedido_con_entrega_y_cobro(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb, jsonb);
drop function if exists public.cobrar_venta(uuid, uuid, jsonb);
drop function if exists public._venta_aplicar_cobro(uuid, jsonb, uuid);
drop function if exists public._venta_puede_cobrar(uuid);
