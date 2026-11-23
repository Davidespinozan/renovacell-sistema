-- Reversa de 20270407480000_ia_tanda2.sql (IA · TANDA 2 · 23 nov 2026). Regresa la búsqueda y el aviso de verificación a como
-- estaban (definiciones de producción del 23 nov 2026), retira la función de existencia, los sinónimos y los casos del examen.
-- pg_trgm se deja instalada (es una extensión estándar de Supabase y no estorba).
delete from public.cc_ia_examen_casos where id in ('CV13', 'CV14', 'CV15', 'CV16', 'CV17', 'CV18', 'CV19', 'CV20', 'CV21', 'CV22');
drop function if exists public.cc_ia_producto_estado(text, text);
CREATE OR REPLACE FUNCTION public.cc_buscar_productos(p_q text, p_limite integer DEFAULT 20, p_audiencia text DEFAULT NULL::text)
 RETURNS TABLE(product_id uuid, nombre text, familia text, categoria text, linea text, presentacion text, es_familia boolean, coincidencia text, puntaje integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_aud text := public._cc_audiencia(p_audiencia); q text := public._cc_norm(p_q); lim int := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  if q is null or length(q) < 2 then return; end if;
  return query
  with vis as (
    select p.* from public.products p where p.active and (case when v_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end)
  ), cand as (
    select p.id, 'sku' as via, 100 as pts from vis p where lower(p.sku) = q
    union all
    select a.product_id, 'alias', 95 from public.cc_product_aliases a join vis p on p.id = a.product_id where a.activo and a.alias_norm = q
    union all
    select p.id, 'nombre', 90 from vis p where public._cc_norm(p.name) = q
    union all
    select p.id, 'nombre_inicio', 80 from vis p where public._cc_norm(p.name) like q || '%'
    union all
    select p.id, 'familia', 75 from vis p where public._cc_norm(p.family) = q
    union all
    select a.product_id, 'alias_parcial', 70 from public.cc_product_aliases a join vis p on p.id = a.product_id where a.activo and a.alias_norm like '%' || q || '%'
    union all
    select p.id, 'nombre_contiene', 60 from vis p where public._cc_norm(p.name) like '%' || q || '%'
    union all
    select p.id, 'familia_contiene', 55 from vis p where public._cc_norm(p.family) like '%' || q || '%'
    union all
    select p.id, 'categoria', 40 from vis p where public._cc_norm(p.category) like '%' || q || '%'
    union all
    select k.product_id, 'conocimiento', 30 from public.cc_product_knowledge k join vis p on p.id = k.product_id
     where k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)
       and to_tsvector('spanish', k.contenido) @@ plainto_tsquery('spanish', p_q)
  ), mejor as (
    select c.id, (array_agg(c.via order by c.pts desc))[1] as via, max(c.pts) as pts from cand c group by c.id
  )
  select p.id, p.name, p.family, p.category, p.line, p.odoo_reference, exists (select 1 from public.products x where x.parent_product_id = p.id), m.via, m.pts
    from mejor m join vis p on p.id = m.id
   order by m.pts desc, p.parent_product_id is null desc, p.name
   limit lim;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.cc_alta_wa_cerrar(p_solicitud uuid, p_customer uuid, p_profile uuid, p_actor uuid, p_enlace text DEFAULT NULL::text, p_cuenta_nueva boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.cc_solicitudes_alta; v_wa text; v_nombre text; v_t text; v_seq bigint;
begin
  perform public._cc_solo_servicio();
  select * into s from public.cc_solicitudes_alta where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'SOLICITUD_NO_PENDIENTE' using errcode = 'check_violation'; end if;
  update public.cc_solicitudes_alta set estado = 'aprobada', customer_id = p_customer, profile_id = p_profile, resuelta_por = p_actor, resuelta_at = now(), updated_at = now() where id = s.id;
  v_wa := (public._cc_wa_contacto_de(s.conversation_id)).wa_id;
  if v_wa is not null and p_profile is not null then
    update public.cc_wa_contactos set vinculo_profile_id = p_profile, vinculado_at = now(), vinculado_via = 'personal', vinculado_por = p_actor where wa_id = v_wa;
  end if;
  v_nombre := public._cc_primer_nombre(s.nombre);
  v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Ya quedaste verificado(a) en Renovacell. Desde ahora te doy tus precios, te cotizo y armamos tu pedido por aquí mismo.'
      || E'\n\n' || 'Además ya tienes tu portal, donde ves tus precios y promociones, el seguimiento de tus pedidos y vuelves a pedir con un toque: '
      || case when p_enlace is not null and p_cuenta_nueva then 'crea tu contraseña aquí ' || p_enlace || ' (el enlace vale una hora; si vence, entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ').'
              when p_cuenta_nueva then 'entra a sistema.renovacell.mx y toca "¿Olvidaste tu contraseña?" con tu correo ' || s.email || ' para crear tu contraseña.'
              else 'entra a sistema.renovacell.mx con tu cuenta de siempre.' end
      || E'\n\n' || '¿Te cotizo lo que me pediste?';
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = s.conversation_id returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (s.conversation_id, v_seq, 'ai', 'tpl:alta_wa:' || s.id, v_t, md5(v_t)) on conflict do nothing;
  return jsonb_build_object('aprobada', true, 'vinculado', v_wa is not null and p_profile is not null);
end;
$function$

;
drop function if exists public._cc_parecido(text, text);
drop function if exists public._cc_ia_q(text);
drop table if exists public.cc_busqueda_sinonimos;
