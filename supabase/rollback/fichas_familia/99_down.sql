-- FICHAS POR FAMILIA (20270225) · down: la ficha vuelve a ser solo del producto (sin herencia) y sale la aprobación en un paso.
create or replace function public._cc_secciones_visibles(p_product uuid, p_aud text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(k.seccion, jsonb_build_object('nivel', k.nivel, 'contenido', k.contenido, 'datos', k.datos, 'version', k.version,
           'fuente', (select jsonb_build_object('tipo', s.tipo, 'referencia', s.referencia, 'documento_url', s.documento_url, 'version', s.version) from public.cc_knowledge_sources s where s.id = k.source_id))), '{}'::jsonb)
    from public.cc_product_knowledge k
   where k.product_id = p_product and k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(p_aud)
     and (k.nivel <> 'T2' or (select t2_habilitado from public.cc_knowledge_config where id = 'default'))
$function$
;
drop function if exists public.cc_conocimiento_aprobar_ficha(uuid, boolean);
