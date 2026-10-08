-- CARTERA-P1 (131) · down: retira las RPC de cartera canónica/histórica y las tablas de equivalencias.
-- No toca cc_cartera, customers ni ninguna asignación. Las equivalencias registradas (si las hubo) se pierden:
-- respaldarlas antes (select * from cc_cartera_historica_equivalencias / _eventos).
drop function if exists public.cc_equivalencia_historica_borrar(text, text);
drop function if exists public.cc_equivalencia_historica_guardar(text, uuid, text);
drop function if exists public.cc_equivalencias_historicas();
drop function if exists public.cc_mi_cartera_historica();
drop function if exists public.cc_mi_cartera();
drop function if exists public._cc_vendedor_consulta();
drop table if exists public.cc_cartera_historica_eventos;
drop table if exists public.cc_cartera_historica_equivalencias;
