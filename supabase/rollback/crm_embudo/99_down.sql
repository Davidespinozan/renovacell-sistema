-- Reversa de 20270321120000_crm_embudo.sql.
drop trigger if exists crm_desde_mensaje on public.cc_messages;
drop trigger if exists crm_desde_conversacion on public.cc_conversations;
drop trigger if exists crm_desde_verificacion on public.profiles;
drop trigger if exists crm_desde_cotizacion on public.cotizaciones;
drop trigger if exists crm_desde_pedido on public.orders;
drop trigger if exists crm_desde_cobro on public.payment_entries;
drop trigger if exists crm_desde_credito on public.credit_grants;
drop function if exists public.crm_resumen(int), public.crm_editar(uuid,text,numeric,uuid), public.crm_crear(uuid,text,numeric), public.crm_mover(uuid,text,text), public.crm_embudo(uuid,int),
  public._crm_json(public.crm_oportunidades), public._crm_puede(uuid), public._crm_ve_todo(), public._crm_tr_pedido(), public._crm_pedido(uuid), public._crm_tr_cotizacion(),
  public._crm_tr_verificado(), public._crm_tr_conversacion(), public._crm_tr_mensaje(), public._crm_nueva(uuid,uuid,uuid,uuid,text,text,text,jsonb), public._crm_avanzar(uuid,text,boolean,text,jsonb),
  public._crm_abierta(uuid,uuid,uuid), public._crm_orden(text);
drop table if exists public.crm_oportunidad_eventos;
drop table if exists public.crm_oportunidades;
