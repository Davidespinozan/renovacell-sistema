-- PREFLIGHT CC · rollback de higiene: devuelve EXECUTE a PUBLIC en los helpers de CC-3 (estado anterior).
grant execute on function public._cc_norm(text), public._cc_es_service(), public._cc_es_admin(), public._cc_nivel_seccion(text), public._cc_audiencia_minima(text), public._cc_audiencia_rango(text),
  public._cc_knowledge_guard(), public._cc_company_guard() to public;
