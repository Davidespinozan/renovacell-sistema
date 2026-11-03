-- MIS CONVERSACIONES · "Prospecto" solo cuando no hay ficha de cliente (3 nov 2026, revisión de la pantalla de Alejandra:
-- Kattya y Patricia ya tienen ficha y salían como prospecto porque no tienen cuenta en el portal).
do $p$
declare d text := pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure);
begin
  if position('''prospecto'', c.profile_id is null,' in d) = 0 then raise exception 'MIS-CONV-PROSPECTO: la función cambió; revisar el parche'; end if;
  d := replace(d, '''prospecto'', c.profile_id is null,', '''prospecto'', c.profile_id is null and c.customer_id is null,');
  execute d;
  if position('c.customer_id is null,' in pg_get_functiondef('public.cc_mis_conversaciones()'::regprocedure)) = 0 then raise exception 'MIS-CONV-PROSPECTO: no quedó aplicada'; end if;
end $p$;
