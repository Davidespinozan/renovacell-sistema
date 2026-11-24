-- ENT-LOCAL (24 nov 2026, dueño: «¿no que ya habíamos hecho que fuera para códigos postales de Culiacán y alrededores?»):
-- la entrega local con chofer solo existe para los C.P. de la zona local (entrega_config: rango + «Otros C.P. locales»),
-- también para el personal. Antes al personal solo se le avisaba («el CP no es de Culiacán») y podía elegirla igual
-- (se dejó así el 23 nov por direcciones de Odoo con C.P. mal capturado; ya se corrigieron: 0 fuera de zona).
-- Sin C.P. todavía, el personal la sigue viendo (el pedido exige calle y C.P. antes de crearse).
do $$
declare d text := pg_get_functiondef('public.entrega_opciones(text,numeric,text,timestamptz)'::regprocedure);
  a1 text := 'case when not v_doc then true when not v_dir then false when not v_local then false else v_sub >= cfg.local_gratis_desde end,';
  b1 text := 'case when not v_doc then (not v_dir or v_local) when not v_dir then false when not v_local then false else v_sub >= cfg.local_gratis_desde end,';
  a2 text := 'case when v_doc and not v_dir then ''REQUIERE_DIRECCION'' when v_doc and not v_local then ''ZONA_FORANEA''';
  b2 text := 'case when v_doc and not v_dir then ''REQUIERE_DIRECCION'' when v_dir and not v_local then ''ZONA_FORANEA''';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'ENT_LOCAL: entrega_opciones cambió; revisar el parche'; end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;
