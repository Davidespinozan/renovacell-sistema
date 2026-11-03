-- Reversa de 20270327120000_cartera_plazo.sql: quita plazos, avisos y la cartera de prospectos; el ruteo, el responsable,
-- la herencia y "Mis conversaciones" vuelven a su texto. Lo asignado por el respaldo de hoy en cartera de fichas/cuentas
-- se quita (motivo exacto); lo demás de la cartera no se toca.
do $cron$ declare r record; begin for r in select jobid from cron.job where jobname = 'renovacell-cartera-plazos' loop perform cron.unschedule(r.jobid); end loop; end $cron$;
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure);
  d := replace(d, '
    -- CARTERA-PLAZO · el prospecto que atendió un vendedor sigue con él mientras dure su plazo.
    elsif c.customer_id is null and public._cc_vendedor_elegible(public._cc_vendedor_de_prospecto(c.visitor_id), false) then s := public._cc_vendedor_de_prospecto(c.visitor_id);', '');
  execute d;
  d := pg_get_functiondef('public._cc_responsable_comercial(uuid)'::regprocedure);
  d := replace(d, '    case when c.profile_id is null and c.customer_id is null and public._cc_vendedor_elegible(public._cc_vendedor_de_prospecto(c.visitor_id), false) then public._cc_vendedor_de_prospecto(c.visitor_id) end,
', '');
  execute d;
  d := pg_get_functiondef('public._cartera_cliente_al_ligar()'::regprocedure);
  d := replace(d, 'insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo, plazo_desde)
    values (new.profile_id, k.seller_profile_id, now(), k.asignado_por, ''Heredado del cliente al ligar su cuenta'', k.plazo_desde);',
    'insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
    values (new.profile_id, k.seller_profile_id, now(), k.asignado_por, ''Heredado del cliente al ligar su cuenta'');');
  execute d;
  d := pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure);
  d := replace(d, ' ''dias_restantes'', public._cc_cartera_dias_conv(c.id),', '');
  execute d;
end $patch$;
create or replace function public._cc_vendedor_conv(p_conv uuid) returns uuid language sql stable security definer set search_path = public as
$$
  select coalesce((select k.seller_profile_id from public.cc_cartera k where c.profile_id is not null and k.profile_id = c.profile_id),
                  case when c.customer_id is not null then public._cc_vendedor_de_cliente(c.customer_id) end,
                  c.ultimo_asesor_id)
    from public.cc_conversations c where c.id = p_conv
$$;
drop trigger if exists cc_cartera_renovar on public.orders;
drop trigger if exists cc_cartera_prospecto_al_ligar on public.cc_conversations;
drop trigger if exists cc_cartera_al_atender on public.cc_conversation_events;
drop function if exists public.cc_cartera_plazos_job(), public.cc_cartera_ranking(), public.cc_cartera_plazos(uuid, integer), public._cc_cartera_filas(),
  public._cc_cartera_renovar(), public._cc_cartera_prospecto_al_ligar(), public._cc_cartera_al_atender(), public._cc_cartera_dias_conv(uuid),
  public._cc_vendedor_de_prospecto(uuid), public._cc_cartera_plazo();
delete from public.cc_cartera where motivo = 'Lo atendió antes del plazo (3 nov 2026)';
delete from public.cc_cartera_clientes where motivo = 'Lo atendió antes del plazo (3 nov 2026)';
drop table if exists public.cc_cartera_eventos;
drop table if exists public.cc_cartera_prospectos;
alter table public.cc_cartera drop column if exists plazo_desde;
alter table public.cc_cartera_clientes drop column if exists plazo_desde;
alter table public.cc_atencion_config drop column if exists cartera_plazo_dias;
