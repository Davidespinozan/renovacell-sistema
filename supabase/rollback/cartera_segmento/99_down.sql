-- Reversa de 20270407510000_cartera_segmento.sql (SEG-CLI · 23 nov 2026).
do $d$
declare v text := pg_get_functiondef('public.cc_mi_cartera()'::regprocedure);
begin
  v := replace(v, ' ''portal'', true, ''verificado'', coalesce(p.verified, false),', '');
  v := replace(v, ' ''portal'', false, ''verificado'', false,', '');
  execute v;
end $d$;
