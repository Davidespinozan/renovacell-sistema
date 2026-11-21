-- EMBUDO SIGUE AL DUEÑO (21 nov 2026, Alejandra: «sospecho que están mezclados»). Revisado en prod: 3 oportunidades
-- abiertas no estaban con la dueña real de su contacto (2 en el embudo de Alejandra y 1 sin vendedora, las 3 de la cartera
-- de Roberto). Causa: la oportunidad tomaba vendedora al nacer y solo se movía cuando la conversación se ligaba a un
-- cliente; si después el contacto cambiaba de dueña (reparto de 24 h, reparto de huérfanas, pasar conversación, cambio
-- de cartera), la oportunidad se quedaba con la anterior.
-- Ahora la oportunidad ABIERTA sigue siempre a la dueña real del contacto (gana la cartera), en cada cambio de asignación.

create or replace function public._crm_dueno_real(o public.crm_oportunidades)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(case when o.customer_id is not null then public._cc_vendedor_de_cliente(o.customer_id) end,
                  case when o.profile_id is not null then (select k.seller_profile_id from public.cc_cartera k where k.profile_id = o.profile_id) end,
                  case when o.conversation_id is not null then public._cc_vendedor_conv(o.conversation_id) end);
$$;

-- Reacomoda las oportunidades abiertas que tocan a un cliente / perfil / visitante / conversación (null = no filtra por eso).
create or replace function public._crm_reacomodar(p_customer uuid, p_profile uuid, p_visitor uuid, p_conv uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer := 0; r public.crm_oportunidades; v uuid;
begin
  for r in
    select o.* from public.crm_oportunidades o
     where o.etapa not in ('ganado', 'perdido')
       and ((p_customer is not null and o.customer_id = p_customer)
         or (p_profile is not null and o.profile_id = p_profile)
         or (p_conv is not null and o.conversation_id = p_conv)
         or (p_visitor is not null and o.conversation_id in (select c.id from public.cc_conversations c where c.visitor_id = p_visitor)))
  loop
    v := public._crm_dueno_real(r);
    if v is not null and v is distinct from r.seller_profile_id then
      update public.crm_oportunidades set seller_profile_id = v, updated_at = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public._crm_tr_asignacion() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  begin
    perform public._crm_reacomodar((j ->> 'customer_id')::uuid,
      case when tg_table_name = 'cc_cartera' then (j ->> 'profile_id')::uuid end,
      (j ->> 'visitor_id')::uuid, (j ->> 'conversation_id')::uuid);
  exception when others then raise warning 'CRM: reacomodar: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists crm_sigue_dueno on public.cc_cartera;
drop trigger if exists crm_sigue_dueno on public.cc_cartera_clientes;
drop trigger if exists crm_sigue_dueno on public.cc_cartera_prospectos;
drop trigger if exists crm_sigue_dueno on public.cc_reparto_contacto;
create trigger crm_sigue_dueno after insert or update or delete on public.cc_cartera for each row execute function public._crm_tr_asignacion();
create trigger crm_sigue_dueno after insert or update or delete on public.cc_cartera_clientes for each row execute function public._crm_tr_asignacion();
create trigger crm_sigue_dueno after insert or update or delete on public.cc_cartera_prospectos for each row execute function public._crm_tr_asignacion();
create trigger crm_sigue_dueno after insert or update or delete on public.cc_reparto_contacto for each row execute function public._crm_tr_asignacion();

-- La conversación cambia de dueña (pasar conversación / retomar): su oportunidad la sigue, aunque ya tuviera vendedora.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public._crm_tr_conversacion()'::regprocedure);
  if position('where conversation_id = new.id and seller_profile_id is null and etapa not in (''ganado'', ''perdido'');' in d) = 0 then
    raise exception 'CRM-DUENO: cambió _crm_tr_conversacion'; end if;
  d := replace(d, 'where conversation_id = new.id and seller_profile_id is null and etapa not in (''ganado'', ''perdido'');',
    'where conversation_id = new.id and seller_profile_id is null and etapa not in (''ganado'', ''perdido'');
      perform public._crm_reacomodar(null, null, null, new.id);   -- CRM-DUENO · gana la dueña real');
  execute d;
end $patch$;

-- Arreglo de lo que ya estaba mezclado
do $fix$
declare n integer;
begin
  select count(*) into n from public.crm_oportunidades o
   where o.etapa not in ('ganado', 'perdido') and public._crm_dueno_real(o) is not null and public._crm_dueno_real(o) is distinct from o.seller_profile_id;
  update public.crm_oportunidades o set seller_profile_id = public._crm_dueno_real(o), updated_at = now()
   where o.etapa not in ('ganado', 'perdido') and public._crm_dueno_real(o) is not null and public._crm_dueno_real(o) is distinct from o.seller_profile_id;
  raise notice 'CRM-DUENO: % oportunidades reacomodadas', n;
end $fix$;
