-- W4 · COMUNICACIONES · El rollback quita el buzón y deja de encolar, y ABORTA si ya
-- hay mensajes confirmados por el proveedor (son evidencia de lo comunicado).
begin;

savepoint antes;
do $t$
declare v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100);
        v_o uuid; v_id uuid; v_claim uuid;
begin
  perform tests.set_email(v_doc, 'x@y.mx');
  v_o := tests.order(v_doc, 'pending_payment', format('[{"product_id":"%s","qty":1,"unit_price":100}]', v_p)::jsonb);
  perform tests.act_as(v_admin);
  select id, claim_token into v_id, v_claim from public.comm_reclamar(10) limit 1;
  perform public.comm_resolver(v_id, v_claim, 'enviado', 'resend', 'msg-1');
  perform tests.act_as_owner();
  begin
    if (select count(*) from public.comm_outbox where status = 'enviado') > 0 then
      raise exception 'ROLLBACK_ABORTADO: hay mensajes confirmados';
    end if;
    perform tests.ok(false, 'el rollback debía abortar');
  exception when others then
    perform tests.ok(sqlerrm like 'ROLLBACK_ABORTADO%',
      'con mensajes ya confirmados por el proveedor, el rollback ABORTA en vez de borrar la evidencia');
  end;
end $t$;
rollback to savepoint antes;

savepoint antes_bajada;
select tests.act_as_owner();
drop trigger if exists trg_comm_payment_entries on public.payment_entries;
drop trigger if exists trg_comm_orders_upd on public.orders;
drop trigger if exists trg_comm_orders_ins on public.orders;
drop function if exists public.comm_reintentar(uuid, boolean);
drop function if exists public.comm_resolver(uuid, uuid, text, text, text, text);
drop function if exists public.comm_reclamar(int);
drop function if exists public._comm_tr_payment_entries();
drop function if exists public._comm_tr_orders();
drop function if exists public._comm_encolar(text, text, uuid, jsonb);
drop function if exists public._comm_autorizar();
drop table    if exists public.comm_outbox;
drop function if exists public.comm_outbox_guard();
drop function if exists public._comm_reclamo_caduco();
drop function if exists public._comm_max_intentos();
drop function if exists public._comm_ventana_idempotencia();

do $t$
declare v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100); v_o uuid;
begin
  perform tests.ok(to_regclass('public.comm_outbox') is null, 'el buzón desapareció');
  perform tests.ok(to_regproc('public.comm_reclamar') is null, 'y sus comandos');
  -- Lo esencial: sin el buzón, las operaciones de negocio siguen funcionando.
  v_o := tests.order(v_doc, 'pending_payment', format('[{"product_id":"%s","qty":1,"unit_price":100}]', v_p)::jsonb);
  perform tests.ok(v_o is not null, 'crear un pedido sigue funcionando sin el buzón');
  perform tests.cobrar(v_o);
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.payment_entries where order_id = v_o) = 1, 'y cobrar también');
  perform tests.ok(to_regclass('public.orders') is not null and to_regclass('public.payment_entries') is not null,
    'W1 y W2 siguen en pie');
end $t$;
rollback to savepoint antes_bajada;

rollback;
