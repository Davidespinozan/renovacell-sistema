-- SEC-C2 (141) · down: quita security_invoker de v_custody_stock y v_custody_liquidacion (vuelven a leer con los privilegios
-- de su dueño, como en producción antes de la 141). No toca definiciones, columnas, dueño, permisos, políticas ni datos.
-- ⚠️ REABRE la exposición: cualquier autenticado (alta pública, sin perfil, chofer, cuenta suspendida) vuelve a leer las
-- existencias y los importes de TODAS las custodias.
do $pre$
declare v regclass;
begin
  foreach v in array array['public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass] loop
    if (select reloptions from pg_class where oid = v) is distinct from array['security_invoker=true'] then
      raise exception 'SEC-C2 down: % no está en el estado SEC-C2 esperado; no se revierte sobre un estado desconocido', v;
    end if;
  end loop;
  if md5(pg_get_viewdef('public.v_custody_stock'::regclass)) <> '894b9ed23d36bba674c20c4d0d818551'
     or md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) <> '794c370463acb6d8080883743e587a20' then
    raise exception 'SEC-C2 down: la definición de las vistas no es la esperada; no se revierte sobre un estado desconocido';
  end if;
end $pre$;

alter view public.v_custody_stock       reset (security_invoker);
alter view public.v_custody_liquidacion reset (security_invoker);

do $post$
declare v regclass;
begin
  foreach v in array array['public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass] loop
    if (select reloptions from pg_class where oid = v) is not null
       or (select relowner = 'postgres'::regrole from pg_class where oid = v) is not true
       or not has_table_privilege('authenticated', v, 'SELECT') or has_table_privilege('anon', v, 'SELECT') then
      raise exception 'SEC-C2 down: % no quedó como en producción', v;
    end if;
  end loop;
  if md5(pg_get_viewdef('public.v_custody_stock'::regclass)) <> '894b9ed23d36bba674c20c4d0d818551'
     or md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) <> '794c370463acb6d8080883743e587a20' then
    raise exception 'SEC-C2 down: la restauración no es idéntica a producción';
  end if;
end $post$;
