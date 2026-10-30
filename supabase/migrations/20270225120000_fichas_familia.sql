-- ============================================================================
-- FICHAS POR FAMILIA (30 oct 2026) · 47 Hidrolizados, 41 Implantes y 20 Ultrafiltrados comparten ficha: se escribe y se
-- aprueba UNA vez en el producto padre y cada presentación la hereda; lo que la presentación tenga aprobado propio (p. ej.
-- los órganos de un Ultrafiltrado) manda sobre lo heredado. Mismas reglas de audiencia y de T2.
-- cc_conocimiento_aprobar_ficha: Dirección aprueba en un paso todos los borradores de un producto, pasando por el mismo
-- cc_conocimiento_aprobar (fuente obligatoria, claims prohibidos, T2 con habilitación y confirmación). Lo que no pase queda
-- en borrador y se informa con su motivo.
-- ============================================================================
create or replace function public._cc_secciones_visibles(p_product uuid, p_aud text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(k.seccion, jsonb_build_object('nivel', k.nivel, 'contenido', k.contenido, 'datos', k.datos, 'version', k.version,
           'fuente', (select jsonb_build_object('tipo', s.tipo, 'referencia', s.referencia, 'documento_url', s.documento_url, 'version', s.version) from public.cc_knowledge_sources s where s.id = k.source_id))
           || case when k.product_id <> p_product then jsonb_build_object('de_la_familia', true) else '{}'::jsonb end), '{}'::jsonb)
    from (select distinct on (k.seccion) k.*
            from public.cc_product_knowledge k
           where k.product_id in (p_product, (select p.parent_product_id from public.products p where p.id = p_product))
             and k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(p_aud)
             and (k.nivel <> 'T2' or (select t2_habilitado from public.cc_knowledge_config where id = 'default'))
           order by k.seccion, (k.product_id = p_product) desc) k
$function$;

create or replace function public.cc_conocimiento_aprobar_ficha(p_product uuid, p_confirmar_clinico boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r record; ok int := 0; pendientes jsonb := '[]'::jsonb; v_msg text;
begin
  perform public._cc_exige_admin();
  for r in select id, seccion from public.cc_product_knowledge where product_id = p_product and estado = 'draft' order by seccion loop
    begin
      perform public.cc_conocimiento_aprobar(r.id, p_confirmar_clinico);
      ok := ok + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      pendientes := pendientes || jsonb_build_array(jsonb_build_object('seccion', r.seccion, 'motivo', split_part(v_msg, ':', 1)));
    end;
  end loop;
  return jsonb_build_object('aprobadas', ok, 'pendientes', pendientes);
end;
$$;
alter function public.cc_conocimiento_aprobar_ficha(uuid, boolean) owner to postgres;
revoke all on function public.cc_conocimiento_aprobar_ficha(uuid, boolean) from public, anon;
grant execute on function public.cc_conocimiento_aprobar_ficha(uuid, boolean) to authenticated;
