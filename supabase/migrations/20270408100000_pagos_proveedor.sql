-- ============================================================================
-- PAGO A PROVEEDOR CON SUS DATOS (27 nov 2026, dueño: «al momento de pagar a proveedor hay que hacer mejor captura de
-- datos de cómo se pagó y de qué banco se pagó, etc.»).
--   Hasta hoy «Marcar pagado» solo cambiaba `replenishments.paid` a verdadero: no quedaba cómo, cuándo, de qué cuenta,
--   con qué referencia ni cuánto. Ahora cada pago queda registrado en `pagos_proveedor`:
--     forma (transferencia, efectivo, tarjeta, cheque u otra), cuenta de la empresa de la que salió (de las cuentas
--     bancarias registradas), banco del proveedor, referencia / folio del movimiento, fecha, monto y notas.
--   · Una sola orden, `compra_registrar_pago`, registra el pago y marca la compra como pagada en la misma transacción.
--     Solo Dirección y Facturación (los mismos que ya podían marcar pagado). Una compra pagada no se vuelve a pagar.
--   · `compra_pagos_ver` devuelve los pagos de las compras que pide, a Dirección y Facturación.
--   · La tabla no se escribe directo (sin permisos de escritura para nadie): solo por la orden. Es de solo agregar.
-- NO altera ninguna tabla existente (regla: nada de alterar tablas en horario laboral): crea una tabla NUEVA, sin uso
-- todavía, con llaves a `replenishments` y `company_bank_accounts` (ambas de muy poco movimiento).
-- Rollback: drop function public.compra_pagos_ver(uuid[]); drop function public.compra_registrar_pago(uuid, text, uuid, date, text, text, text);
--           drop table public.pagos_proveedor;   (las compras ya marcadas pagadas siguen pagadas)
-- ============================================================================
do $pre$ begin
  if to_regclass('public.pagos_proveedor') is not null then raise exception 'PAGOS-PROVEEDOR: ya aplicada'; end if;
  if to_regclass('public.replenishments') is null or to_regclass('public.company_bank_accounts') is null then raise exception 'PAGOS-PROVEEDOR: faltan compras o cuentas bancarias'; end if;
  if to_regprocedure('public.log_audit(text, text, text, text)') is null then raise exception 'PAGOS-PROVEEDOR: falta la bitácora'; end if;
end $pre$;

create table public.pagos_proveedor (
  id uuid primary key default gen_random_uuid(),
  replenishment_id uuid not null references public.replenishments(id),
  monto numeric(14, 2) not null check (monto > 0),
  forma text not null check (forma in ('transferencia', 'efectivo', 'tarjeta', 'cheque', 'otro')),
  cuenta_id uuid references public.company_bank_accounts(id),
  cuenta_texto text,                       -- cómo se veía la cuenta al pagar («Scotiabank · 9474»): no cambia si la cuenta se edita
  banco_proveedor text check (banco_proveedor is null or length(banco_proveedor) <= 120),
  referencia text check (referencia is null or length(referencia) <= 120),
  fecha date not null,
  notas text check (notas is null or length(notas) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
comment on table public.pagos_proveedor is 'Pagos hechos a proveedores: forma, cuenta de salida, referencia, fecha y monto. Solo agregar; se escribe con compra_registrar_pago.';
alter table public.pagos_proveedor enable row level security;
create policy pagos_proveedor_leer on public.pagos_proveedor for select to authenticated using (public.auth_role() in ('admin', 'billing'));
revoke insert, update, delete on public.pagos_proveedor from authenticated, anon;

create function public.compra_registrar_pago(p_compra uuid, p_forma text, p_cuenta uuid, p_fecha date, p_referencia text, p_banco_proveedor text, p_notas text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r public.replenishments; v_monto numeric; v_cta public.company_bank_accounts; v_cta_txt text;
  v_ref text := nullif(btrim(coalesce(p_referencia, '')), ''); v_bp text := nullif(btrim(coalesce(p_banco_proveedor, '')), ''); v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_hoy date := (now() at time zone 'America/Mazatlan')::date; v_id uuid;
begin
  if auth.uid() is null or public.auth_role() not in ('admin', 'billing') then raise exception 'NO_AUTORIZADO: solo Dirección o Facturación registran el pago a proveedores'; end if;
  select * into r from public.replenishments where id = p_compra for update;
  if not found then raise exception 'COMPRA_INEXISTENTE: esa compra no existe'; end if;
  if r.kind <> 'compra' then raise exception 'PAGO_INVALIDO: la producción interna no se le paga a un proveedor'; end if;
  if r.paid then raise exception 'COMPRA_YA_PAGADA: esta compra ya está registrada como pagada'; end if;
  if p_forma is null or p_forma not in ('transferencia', 'efectivo', 'tarjeta', 'cheque', 'otro') then raise exception 'PAGO_INVALIDO: elige cómo se pagó'; end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 400 then raise exception 'PAGO_INVALIDO: la fecha del pago no puede ser futura ni de hace más de un año'; end if;
  if p_forma in ('transferencia', 'tarjeta', 'cheque') then
    if p_cuenta is null then raise exception 'PAGO_INVALIDO: elige de qué cuenta de la empresa salió el pago'; end if;
  end if;
  if p_cuenta is not null then
    select * into v_cta from public.company_bank_accounts where id = p_cuenta;
    if not found then raise exception 'PAGO_INVALIDO: esa cuenta bancaria no existe'; end if;
    v_cta_txt := v_cta.bank_name || ' · ' || right(coalesce(nullif(v_cta.clabe, ''), v_cta.account_number, ''), 4);
  end if;
  if p_forma in ('transferencia', 'cheque') and v_ref is null then raise exception 'PAGO_INVALIDO: escribe la referencia o folio del movimiento (o el número de cheque)'; end if;
  if length(coalesce(v_ref, '')) > 120 or length(coalesce(v_bp, '')) > 120 or length(coalesce(v_notas, '')) > 500 then raise exception 'PAGO_INVALIDO: algún dato es demasiado largo'; end if;

  v_monto := round(r.qty * r.unit_cost, 2);
  if v_monto <= 0 then raise exception 'PAGO_INVALIDO: la compra no tiene un importe que pagar'; end if;
  insert into public.pagos_proveedor (replenishment_id, monto, forma, cuenta_id, cuenta_texto, banco_proveedor, referencia, fecha, notas)
  values (r.id, v_monto, p_forma, p_cuenta, v_cta_txt, v_bp, v_ref, p_fecha, v_notas) returning id into v_id;
  update public.replenishments set paid = true where id = r.id;
  perform public.log_audit('Pago a proveedor', r.product_name,
    jsonb_build_object('compra', r.id, 'proveedor', r.supplier, 'monto', v_monto, 'forma', p_forma, 'cuenta', v_cta_txt, 'referencia', v_ref, 'fecha', p_fecha)::text, null);
  return jsonb_build_object('pago_id', v_id, 'compra', r.id, 'monto', v_monto);
end;
$function$;

create function public.compra_pagos_ver(p_compras uuid[])
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('compra', g.replenishment_id, 'monto', g.monto, 'forma', g.forma, 'cuenta', g.cuenta_texto,
           'banco_proveedor', g.banco_proveedor, 'referencia', g.referencia, 'fecha', g.fecha, 'notas', g.notas,
           'registro', coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = g.created_by), ''), 'registrado_at', g.created_at)
           order by g.created_at), '[]'::jsonb)
    from public.pagos_proveedor g
   where auth.uid() is not null and public.auth_role() in ('admin', 'billing') and g.replenishment_id = any (coalesce(p_compras, '{}'));
$function$;

revoke all on function public.compra_registrar_pago(uuid, text, uuid, date, text, text, text) from public, anon;
revoke all on function public.compra_pagos_ver(uuid[]) from public, anon;
grant execute on function public.compra_registrar_pago(uuid, text, uuid, date, text, text, text) to authenticated, service_role;
grant execute on function public.compra_pagos_ver(uuid[]) to authenticated, service_role;
