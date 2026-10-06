-- ============================================================================
-- PREFLIGHT CC · HIGIENE DE PRIVILEGIOS: helpers internos de CC-3 que quedaron ejecutables por
-- PUBLIC/anon (defaults de EXECUTE). Son funciones puras o guardas (no exponen datos), pero la
-- regla transversal es que anon solo ejecute las lecturas públicas de conocimiento. Sin cambio
-- funcional. Rollback: supabase/rollback/cc_preflight/99_down.sql (devuelve los defaults).
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public._cc_norm(text)') is null then raise exception 'PREFLIGHT: falta CC-3'; end if;
end $pre$;
revoke all on function public._cc_norm(text), public._cc_es_service(), public._cc_es_admin(), public._cc_nivel_seccion(text), public._cc_audiencia_minima(text), public._cc_audiencia_rango(text),
  public._cc_knowledge_guard(), public._cc_company_guard() from public, anon;
do $post$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and (p.proname like 'cc\_%' or p.proname like '\_cc\_%') and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not in ('cc_ficha_producto', 'cc_buscar_productos', 'cc_buscar_conocimiento', 'cc_comparar_productos', 'cc_candidatos_recomendacion', 'cc_catalogo_para_ia', 'cc_audiencia_actual', 'cc_revisar_claims');
  if n <> 0 then raise exception 'PREFLIGHT: anon aún ejecuta % funciones cc_* no públicas', n; end if;
end $post$;
