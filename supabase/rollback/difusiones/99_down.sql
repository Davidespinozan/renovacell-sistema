-- HERRAMIENTAS DEL VENDEDOR · bloque D (20270217) · down: fuera listas, difusiones y baja; el buzón vuelve a su catálogo de
-- plantillas (se niega si ya hay correos de difusión en el buzón: no se pierde el rastro de lo enviado).
do $g$ begin
  if exists (select 1 from public.comm_outbox where plantilla = 'difusion') and coalesce(current_setting('app.difusiones_rollback_forzado', true), '') <> 'on' then
    raise exception 'BLOQUE-D down: hay correos de difusión en el buzón'; end if;
end $g$;
grant insert, update, delete, truncate, references, trigger on public.especialidades to authenticated;   -- como lo dejó BLOQUE-B
drop function public.correo_baja(uuid);
drop function public.mis_difusiones();
drop function public.difusion_prueba(text, text, text, text);
drop function public.difusion_enviar(text, text, text, text, jsonb, text[]);
drop function public._dif_payload(public.cc_difusiones, public.customers);
drop function public.difusion_previa(jsonb);
drop function public.lista_buscar_clientes(uuid, text, boolean, integer);
drop function public.lista_agregar_filtro(uuid, text, text);
drop function public.lista_clientes_cambiar(uuid, uuid[], boolean);
drop function public.lista_borrar(uuid);
drop function public.lista_guardar(uuid, text);
drop function public.mis_listas();
drop function public._dif_correo_de(public.customers);
drop function public._dif_audiencia(jsonb);
drop function public._dif_es_mio(uuid, boolean, uuid);
drop function public._dif_alcance();
drop table public.cc_difusion_envios;
drop table public.cc_difusiones;
drop table public.cc_etiqueta_clientes;
drop table public.cc_etiquetas;
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado', 'pedido_cancelado', 'reembolso_realizado',
  'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada', 'promocion', 'cotizacion'));
drop index public.ux_customers_baja_token;
alter table public.customers drop column difusiones_baja_at, drop column correo_baja_token;
