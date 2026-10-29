-- COTIZACIONES (20270209) · down: se retiran los comandos y la tabla (con sus cotizaciones); la plantilla vuelve a la lista anterior.
drop function if exists public.cc_cotizacion_cancelar(uuid);
drop function if exists public.cc_cotizacion_convertida(uuid, uuid);
drop function if exists public.cc_cotizacion_enviar(uuid, text);
drop function if exists public.cc_cotizacion_crear(uuid, jsonb, text, uuid);
drop function if exists public._cot_exige(uuid);
drop table if exists public.cotizaciones;
drop function if exists public._cot_puede_leer(uuid);
drop sequence if exists public.cotizacion_folio_seq;
delete from public.comm_outbox where plantilla = 'cotizacion';
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado',
  'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion'));
