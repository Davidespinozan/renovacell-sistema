-- ENT-CPX (23 nov 2026) · CÓDIGOS POSTALES LOCALES EXTRA.
-- El rango 80000–80299 deja fuera colonias urbanas de Culiacán que el chofer sí atiende: 80308 (Aguaruto),
-- 80301 (Cantabria, Hacienda Santa Clara), 80316 (La Reforma, Las Guásimas). No se puede ampliar el rango
-- porque 80300 es Culiacancito (el dueño: "nomás Culiacancito no") y del 80320 en adelante es Navolato.
-- Solución: una lista de CP extra que también cuentan como entrega local. Dirección la edita en Configuración.

-- ── 1) Columna: lista de CP de 5 dígitos (máx. 50) ──
alter table public.entrega_config
  add column cp_local_extra text[] not null default '{}'
  constraint ck_entcfg_cp_extra check (cardinality(cp_local_extra) <= 50 and array_to_string(cp_local_extra, ',') ~ '^([0-9]{5}(,[0-9]{5})*)?$');

update public.entrega_config set cp_local_extra = array['80301', '80308', '80316'] where id = 1;

-- ── 2) ¿Es local? rango O lista extra ──
create or replace function public._entrega_es_local(p_cp text) returns boolean
language sql stable set search_path = public
as $$ select p_cp ~ '^[0-9]{5}$' and (p_cp between c.cp_local_desde and c.cp_local_hasta or p_cp = any(c.cp_local_extra)) from public.entrega_config c where c.id = 1 $$;

-- ── 3) entrega_config_guardar: Dirección edita la lista (arreglo de textos; sin la llave, se conserva) ──
do $patch$
declare v text := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  ancla constant text := '    dias_paqueteria      = coalesce(';
begin
  if position(ancla in v) = 0 then raise exception 'ENT-CPX: entrega_config_guardar cambió'; end if;
  if position('cp_local_extra' in v) > 0 then raise exception 'ENT-CPX: entrega_config_guardar ya trae cp_local_extra'; end if;
  execute replace(v, ancla,
'    -- ENT-CPX · CP extra que también son locales
    cp_local_extra       = case when jsonb_typeof(p -> ''cp_local_extra'') = ''array''
                                then coalesce((select array_agg(distinct btrim(x) order by btrim(x)) from jsonb_array_elements_text(p -> ''cp_local_extra'') x where btrim(x) <> ''''), ''{}'')
                                else cfg.cp_local_extra end,
' || ancla);
  v := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  if position('cp_local_extra       = case' in v) = 0 then raise exception 'ENT-CPX: entrega_config_guardar no quedó'; end if;
end $patch$;
