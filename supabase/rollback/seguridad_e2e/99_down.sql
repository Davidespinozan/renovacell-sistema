-- Reversa de 20270318120000_seguridad_e2e.sql.
update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'media';
drop trigger if exists profiles_insert_guard on public.profiles;
drop function if exists public._profiles_insert_guard();
do $d$
declare v text; i int; j int;
begin
  v := pg_get_functiondef('public.orders_guard()'::regprocedure);
  i := position('  -- SEG-E2E · P1-1:' in v);
  if i > 0 then j := position('  -- W3-A · H-3:' in v); execute substr(v, 1, i - 1) || substr(v, j); end if;
  v := pg_get_functiondef('public.set_order_fiscal_snapshot'::regproc);
  v := replace(v, '  if v_role = any (array[''admin'',''billing'']) or (v_role = ''pos'' and public._sec_c1_pos_ve_pedido(p_order_id)) then   -- FISCAL-1: Ventas, solo sus pedidos
    null;', '  if v_role = any (array[''admin'',''billing'',''pos'']) then
    null;'); execute v;
  v := pg_get_functiondef('public.solicitar_cfdi'::regproc);
  v := replace(v, '  if v_role = any (array[''admin'',''billing'']) or (v_role = ''pos'' and public._sec_c1_pos_ve_pedido(p_order_id)) then null;   -- FISCAL-1: Ventas, solo sus pedidos', '  if v_role = any (array[''admin'',''billing'',''pos'']) then null;'); execute v;
  v := pg_get_functiondef('public.link_pago_enviar(uuid,text)'::regprocedure);
  v := replace(v, '
  if not public._lp_autorizado(l.order_id) then raise exception ''NO_AUTORIZADO: ese pedido es de otro vendedor'' using errcode = ''insufficient_privilege''; end if;
  if l.estado = ''enviado'' and l.enviado_por is distinct from auth.uid() and public.auth_role() = ''pos'' then
    raise exception ''LINK_YA_ENVIADO: otro vendedor ya mandó ese link; pide a Dirección que lo cancele'' using errcode = ''insufficient_privilege''; end if;', '');
  v := replace(v, '  v_bb := v_dom ~ ''(^|\.)(bb\.com\.mx|bancobajio\.com\.mx|banbajio\.com\.mx|bajionet\.com\.mx)$'';   -- el dominio ES del banco', '  v_bb := v_dom ~ ''(bajio|bb\.com\.mx)'';'); execute v;
  v := pg_get_functiondef('public.link_pago_cancelar'::regproc);
  v := replace(v, '  if not public._lp_autorizado((select x.order_id from public.pago_links x where x.id = p_link)) then raise exception ''NO_AUTORIZADO: ese pedido es de otro vendedor'' using errcode = ''insufficient_privilege''; end if;
', ''); execute v;
end $d$;
drop function if exists public._lp_autorizado(uuid);
