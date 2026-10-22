-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CS-1A.1b · GUARDA UNIVERSAL DE RESERVAS EN EL LEDGER (migración 185)
--   Invariante (CS-D05/D06/D07): ningún canal registra un COBRO que invada una reserva activa de tarjeta.
--   Punto de control único: TODO asiento entra por `_w2_asiento` → `insert into payment_entries`; aquí se cuelga un
--   trigger BEFORE INSERT (solo direction='in' sin reversal_of). No se toca ningún comando (registrar_cobro, revisar_pago,
--   vender_pos, cc_checkout_confirmar conservan firma y cuerpo; SEC-B sigue fijando sus md5) ni v_order_money.
--   Cómo decide:
--     · toma `orders … FOR UPDATE` (serializa con cs_intento_abrir y con los comandos que ya lo bloquean; vender_pos crea
--       su propio pedido en la misma transacción, así que nunca compite por un pedido reservado);
--     · reservas = Σ importe de intentos en estado activo (created…captured) o desconocido, EXCLUYENDO el que este mismo
--       asiento consume: intento `captured` del MISMO pedido cuyo cs_payment_id = external_ref del asiento, con el mismo
--       importe y método 'tarjeta'. Esa coincidencia estructural ES la prueba de legitimidad: NO se confía en ninguna
--       variable de sesión (app.cs_attempt se ignora; quien la falsifique no gana nada);
--     · si NO hay reservas → no interviene (comportamiento histórico intacto, sobrepago sigue solo marcado);
--     · si hay reservas y cobrado_neto + nuevo + reservas > total → RESERVA_ACTIVA con el importe disponible.
--   Lo que NO cambia: reembolsos (direction out), reversas (reversal_of), crédito, liberación, cortes de caja, idempotencia.
--   Rollback: supabase/rollback/cs1b_reserva_guard/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.card_payment_attempts') is null or to_regprocedure('public._cs_estado_activo(text)') is null then raise exception 'CS1B: falta CS-1A.1a'; end if;
  if to_regclass('public.payment_entries') is null then raise exception 'CS1B: falta payment_entries'; end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard') then raise exception 'CS1B: ya aplicada'; end if;
end $pre$;

create function public._cs_reserva_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_total numeric; v_neto numeric; v_reservas numeric; v_disp numeric;
begin
  if new.direction <> 'in' or new.reversal_of is not null then return new; end if;
  -- mutex del pedido: la apertura de intentos y los comandos de cobro pasan por aquí
  perform 1 from public.orders o where o.id = new.order_id for update;
  select coalesce(sum(a.amount), 0) into v_reservas
    from public.card_payment_attempts a
   where a.order_id = new.order_id and public._cs_estado_activo(a.status)
     and not (a.status = 'captured' and new.method = 'tarjeta' and a.cs_payment_id is not null
              and a.cs_payment_id = new.external_ref and a.amount = new.amount);   -- consumo de la reserva propia (estructural, sin variables de sesión)
  if v_reservas <= 0 then return new; end if;   -- sin reservas: el ledger se comporta exactamente como antes
  select coalesce(o.total, 0) into v_total from public.orders o where o.id = new.order_id;
  select coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0) into v_neto
    from public.payment_entries e where e.order_id = new.order_id;
  v_disp := v_total - v_neto - v_reservas;
  if v_neto + new.amount + v_reservas > v_total then
    raise exception 'RESERVA_ACTIVA: el pedido tiene % reservados por un cobro con tarjeta en curso; disponible para otros cobros: %', v_reservas, greatest(v_disp, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
comment on function public._cs_reserva_guard() is
  'CS-1A.1b · BEFORE INSERT en payment_entries (direction in, sin reversa): rechaza cobros que invadan reservas activas de tarjeta; '
  'excluye solo el asiento que consume su propia reserva (mismo pedido, captured, external_ref = cs_payment_id, mismo importe, tarjeta). '
  'No usa variables de sesión. Sin reservas no interviene.';
revoke all on function public._cs_reserva_guard() from public, anon, authenticated;

create trigger trg_cs_reserva_guard before insert on public.payment_entries
  for each row execute function public._cs_reserva_guard();

do $post$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard' and tgrelid = 'public.payment_entries'::regclass) then raise exception 'CS1B: falta el trigger'; end if;
  if not (select prosecdef from pg_proc where oid = 'public._cs_reserva_guard()'::regprocedure) then raise exception 'CS1B: la guarda debe ser security definer'; end if;
  -- los comandos financieros no cambian de cuerpo (SEC-B los fija; aquí solo se confirma que existen con su firma)
  if to_regprocedure('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)') is null
     or to_regprocedure('public.revisar_pago(uuid,uuid,text,numeric,date,text)') is null then raise exception 'CS1B: faltan comandos del ledger'; end if;
end $post$;
