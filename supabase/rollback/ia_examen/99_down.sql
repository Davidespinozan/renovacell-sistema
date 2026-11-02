-- IA EXAMEN (20270228) · down: retira configuración del modelo, examen y comparación IA vs equipo.
drop function if exists public.ia_vs_humano(int);
drop function if exists public.ia_examen_resultados(uuid);
drop function if exists public.ia_examen_corridas();
drop function if exists public.ia_examen_registrar(uuid, text, jsonb);
drop function if exists public.ia_examen_caso(uuid, text);
drop function if exists public.ia_examen_crear(text, uuid, text, text[], text);
drop function if exists public.ia_config_guardar(text, text);
drop function if exists public.ia_config();
drop table if exists public.cc_ia_examen_resultados;
drop table if exists public.cc_ia_examen_corridas;
drop table if exists public.cc_ia_examen_casos;
drop table if exists public.cc_ia_config;
