-- Reversa de 20270407490000_entrega_cp_extra.sql (ENT-CPX · 23 nov 2026).
do $d$
declare v text; i int; j int;
begin
  v := pg_get_functiondef('public.entrega_config_guardar(jsonb)'::regprocedure);
  i := position('    -- ENT-CPX · CP extra que también son locales' in v);
  if i > 0 then
    j := position('    dias_paqueteria      = coalesce(' in v);
    execute substr(v, 1, i - 1) || substr(v, j);
  end if;
end $d$;

create or replace function public._entrega_es_local(p_cp text) returns boolean
language sql stable set search_path = public
as $$ select p_cp ~ '^[0-9]{5}$' and p_cp between c.cp_local_desde and c.cp_local_hasta from public.entrega_config c where c.id = 1 $$;

alter table public.entrega_config drop column if exists cp_local_extra;
