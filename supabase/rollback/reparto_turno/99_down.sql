-- Reversa de 20270312120000_reparto_turno.sql: definiciones de producción del 2 nov 2026 antes del cambio.
do $d$
declare v text := pg_get_functiondef('public.promocion_difundir(uuid,text[],uuid)'::regprocedure);
begin
  if position('if not public._promo_puede_difundir(p_vendedor) then raise exception ''NO_AUTORIZADO: solo Dirección, Facturación o el vendedor a su propia cartera mandan promociones''' in v) > 0 then execute replace(v, 'if not public._promo_puede_difundir(p_vendedor) then raise exception ''NO_AUTORIZADO: solo Dirección, Facturación o el vendedor a su propia cartera mandan promociones''', 'if not public._promo_puede_administrar() then raise exception ''NO_AUTORIZADO: solo Dirección o Facturación mandan promociones'''); end if;
end $d$;
drop function if exists public._promo_puede_difundir(uuid);
CREATE OR REPLACE FUNCTION public._promo_puede_administrar()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select auth.uid() is not null and public.auth_role() in ('admin', 'billing') $function$;
CREATE OR REPLACE FUNCTION public._cc_reparto_elegir(p_conv uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id from public.profiles p
   where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true)
     and not (p.id = any (coalesce((select c.reparto_probados from public.cc_conversations c where c.id = p_conv), '{}')))
   order by random() limit 1
$function$;
CREATE OR REPLACE FUNCTION public._cc_vendedor_azar(p_excluir uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id from public.profiles p
   where p.role_id = 'pos' and not coalesce(p.interna, false) and public._cc_vendedor_elegible(p.id, true) and not (p.id = any (coalesce(p_excluir, '{}')))
   order by random() limit 1
$function$;
CREATE OR REPLACE FUNCTION public._cc_responsable_comercial(p_conv uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end,
    case when c.profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(c.profile_id), false) then public._cc_vendedor_de(c.profile_id) end,
    (select public._cc_vendedor_de(w.vinculo_profile_id) from public.cc_wa_contactos w
      where w.wa_id = (public._cc_wa_contacto_de(c.id)).wa_id and w.vinculo_profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(w.vinculo_profile_id), false)),
    case when c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then public._cc_vendedor_de_cliente(c.customer_id) end,
    case when public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then c.ultimo_asesor_id end)
  from public.cc_conversations c where c.id = p_conv
$function$;
CREATE OR REPLACE FUNCTION public._cc_avisar_responsable(p_conv uuid, p_kind text, p_texto text, p_llave text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s uuid := public._cc_responsable_comercial(p_conv);
begin
  if v_s is not null then return public._cc_notificar(p_kind, p_conv, array[v_s], null, p_texto, 'asesorias', p_llave); end if;
  return public._cc_notificar(p_kind, p_conv, null, array['admin'], p_texto, 'av_atencion', p_llave);
end;
$function$;
drop function if exists public._cc_vendedor_turno(uuid[]);
drop table if exists public.cc_reparto_turnos;
