-- Reversa de 20270407520000_cartera_segmento_odoo.sql (SEG-CLI-2 · 23 nov 2026).
do $d$
declare v text := pg_get_functiondef('public.cc_mi_cartera()'::regprocedure);
begin
  execute replace(v, ' ''portal'', false, ''verificado'', (cu.source = ''odoo''),', ' ''portal'', false, ''verificado'', false,');
end $d$;
