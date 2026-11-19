-- EMBUDO SIGUE A LA CARTERA (19 nov 2026, reporte de Alejandra: «me aparece Luz Andreina en el embudo y no es mía»).
-- Una conversación de WhatsApp sin ficha se repartía a una vendedora y su oportunidad nacía a su nombre; al ligarse
-- después a la ficha del cliente (de la cartera de OTRA vendedora), la conversación pasaba a la dueña de la cartera pero la
-- oportunidad se quedaba con la primera. Ahora, al ligar la conversación a un cliente con cartera, sus oportunidades
-- abiertas pasan a esa vendedora (gana la cartera, como en todo el sistema). Se corrige el único caso existente.
do $pre$ begin
  if position('update public.crm_oportunidades set customer_id = new.customer_id, updated_at = now() where conversation_id = new.id and customer_id is null and etapa not in (''ganado'', ''perdido'');' in pg_get_functiondef('public._crm_tr_conversacion()'::regprocedure)) = 0 then
    raise exception 'CRM-CARTERA: _crm_tr_conversacion cambió; revisar'; end if;
end $pre$;

do $patch$
declare d text := pg_get_functiondef('public._crm_tr_conversacion()'::regprocedure);
begin
  execute replace(d,
    'update public.crm_oportunidades set customer_id = new.customer_id, updated_at = now() where conversation_id = new.id and customer_id is null and etapa not in (''ganado'', ''perdido'');',
    'update public.crm_oportunidades set customer_id = new.customer_id, updated_at = now() where conversation_id = new.id and customer_id is null and etapa not in (''ganado'', ''perdido'');
      -- CRM-CARTERA · gana la cartera: la oportunidad pasa a la vendedora del cliente
      update public.crm_oportunidades set seller_profile_id = public._cc_vendedor_de_cliente(new.customer_id), updated_at = now()
       where conversation_id = new.id and etapa not in (''ganado'', ''perdido'') and public._cc_vendedor_de_cliente(new.customer_id) is not null
         and seller_profile_id is distinct from public._cc_vendedor_de_cliente(new.customer_id);');
end $patch$;

-- Corrección de los casos existentes (hoy: Luz Andreina Álvarez Chávez → Roberto Ibarra), con aviso a quien la recibe.
do $fix$
declare r record;
begin
  for r in select o.id, o.customer_id, public._cc_vendedor_de_cliente(o.customer_id) dueña, o.seller_profile_id antes
             from public.crm_oportunidades o
            where o.etapa not in ('ganado', 'perdido') and o.customer_id is not null
              and public._cc_vendedor_de_cliente(o.customer_id) is not null and o.seller_profile_id is distinct from public._cc_vendedor_de_cliente(o.customer_id) loop
    update public.crm_oportunidades set seller_profile_id = r.dueña, updated_at = now() where id = r.id;
    perform public._cc_notificar('crm_oportunidad', null, array[r.dueña], null,
      format('Te pasamos la oportunidad de %s: es de tu cartera (estaba por error con %s).', coalesce((select initcap(lower(full_name)) from public.customers where id = r.customer_id), 'un cliente'), coalesce(public._cc_nombre_personal(r.antes), 'otra vendedora')),
      'crm_embudo', 'crm_cartera:' || r.id::text);
  end loop;
end $fix$;

do $post$ begin
  if exists (select 1 from public.crm_oportunidades o where o.etapa not in ('ganado', 'perdido') and o.customer_id is not null
               and public._cc_vendedor_de_cliente(o.customer_id) is not null and o.seller_profile_id is distinct from public._cc_vendedor_de_cliente(o.customer_id)) then
    raise exception 'CRM-CARTERA: quedaron oportunidades con otra vendedora'; end if;
end $post$;
