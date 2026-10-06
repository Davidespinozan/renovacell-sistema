-- ============================================================================
-- CC-3 · ROLLBACK. Retira el dominio de conocimiento completo. No toca `products` ni ninguna
-- tabla previa (CC-3 solo AÑADE). El conocimiento capturado localmente se pierde (CC-3 nunca
-- llegó a producción). Ejecutar en UNA transacción.
-- ============================================================================
drop function if exists public.cc_catalogo_para_ia(text, int);
drop function if exists public.cc_candidatos_recomendacion(text, text, text[], int, text);
drop function if exists public.cc_comparar_productos(uuid[], text);
drop function if exists public.cc_buscar_conocimiento(text, int, text);
drop function if exists public.cc_buscar_productos(text, int, text);
drop function if exists public.cc_ficha_producto(uuid, text);
drop function if exists public._cc_secciones_visibles(uuid, text);
drop function if exists public.cc_importar_conocimiento_existente();
drop function if exists public.cc_empresa_listar();
drop function if exists public.cc_conocimiento_listar(uuid);
drop function if exists public.cc_cobertura();
drop function if exists public.cc_config_t2(boolean);
drop function if exists public.cc_empresa_retirar(uuid, text);
drop function if exists public.cc_empresa_aprobar(uuid);
drop function if exists public.cc_empresa_guardar(text, text, text, uuid, text, uuid, int);
drop function if exists public.cc_relacion_retirar(uuid);
drop function if exists public.cc_relacion_guardar(uuid, uuid, text, uuid, text, boolean);
drop function if exists public.cc_alias_retirar(uuid);
drop function if exists public.cc_alias_guardar(uuid, text, text);
drop function if exists public.cc_conocimiento_restaurar(uuid);
drop function if exists public.cc_conocimiento_retirar(uuid, text);
drop function if exists public.cc_conocimiento_aprobar(uuid, boolean);
drop function if exists public.cc_conocimiento_guardar(uuid, text, text, jsonb, uuid, text, uuid, int);
drop function if exists public.cc_fuentes_listar();
drop function if exists public.cc_fuente_registrar(text, text, text, text, text);
drop function if exists public._cc_producto_visible(uuid, text);
drop function if exists public._cc_identidad(uuid);
drop function if exists public._cc_exige_admin();
drop function if exists public._cc_evento_k(text, uuid, text, int, jsonb);
drop function if exists public.cc_revisar_claims(text);
drop function if exists public.cc_audiencia_actual();
drop function if exists public._cc_audiencia(text);
drop function if exists public._cc_es_admin();
drop function if exists public._cc_es_service();
drop function if exists public._cc_norm(text);

drop table if exists public.cc_knowledge_events;
drop table if exists public.cc_knowledge_config;
drop table if exists public.cc_claim_rules;
drop table if exists public.cc_company_knowledge;
drop table if exists public.cc_product_relations;
drop table if exists public.cc_product_aliases;
drop table if exists public.cc_product_knowledge;
drop table if exists public.cc_knowledge_sources;

drop function if exists public._cc_company_guard();
drop function if exists public._cc_knowledge_guard();
drop function if exists public._cc_audiencia_rango(text);
drop function if exists public._cc_audiencia_minima(text);
drop function if exists public._cc_nivel_seccion(text);
