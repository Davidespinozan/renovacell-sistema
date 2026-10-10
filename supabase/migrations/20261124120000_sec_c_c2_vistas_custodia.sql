-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-C2 (migración 141) · CX-SEC-01 / F3 · VISTAS DE CUSTODIA CON LOS PRIVILEGIOS DEL QUE CONSULTA
--   Hallazgo (auditado y reproducido en cluster desechable): v_custody_stock y v_custody_liquidacion no tenían
--   security_invoker ⇒ leían custodies / custody_lines con los privilegios de su dueño (postgres: BYPASSRLS y dueño de las
--   tablas), no tienen filtro propio y authenticated tiene SELECT. El RLS de las tablas (correcto) nunca se evaluaba: CUALQUIER
--   autenticado —alta pública del portal, usuario sin perfil, chofer e incluso una cuenta suspendida— leía existencias e
--   importes de TODAS las custodias.
--   Cambio (único): security_invoker = true en ambas vistas. Con eso se aplica el RLS que ya existe:
--     · custodies / custody_lines: Dirección, Facturación, Almacén, Empaque, o el titular (holder_user_id = auth.uid()).
--   Lo que NO cambia: definición y columnas de las vistas, dueño, permisos, políticas, tablas, funciones y datos.
--   Las funciones SECURITY DEFINER que leen estas vistas (estado_custodia, cerrar_custodia, conciliar_custodia) corren como su
--   dueño y conservan su resultado; su autorización sigue en sus propias compuertas.
--   No se crea ninguna autorización nueva: correo, teléfono, vendedor de Odoo, capturista o customers.profile_id NO dan acceso;
--   un titular "tercero" (holder_customer_id) no tiene vía de consulta propia (requiere diseño aparte).
--   Rollback: supabase/rollback/sec_c2/99_down.sql (REABRE la exposición).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare v regclass;
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'SEC-C2: security_invoker en vistas requiere PostgreSQL 15 o superior';
  end if;
  foreach v in array array['public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass] loop
    if (select relkind = 'v' and relowner = 'postgres'::regrole from pg_class where oid = v) is not true then
      raise exception 'SEC-C2: % no es una vista ordinaria de postgres', v;
    end if;
    if exists (select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}')) o where c.oid = v and o like 'security_invoker=%') then
      raise exception 'SEC-C2: % ya tiene security_invoker (ya aplicada o drift)', v;
    end if;
    if (select reloptions from pg_class where oid = v) is not null then
      raise exception 'SEC-C2: % tiene opciones no auditadas', v;
    end if;
    if not has_table_privilege('authenticated', v, 'SELECT') or not has_table_privilege('service_role', v, 'SELECT')
       or has_table_privilege('anon', v, 'SELECT')
       or has_table_privilege('authenticated', v, 'INSERT') or has_table_privilege('authenticated', v, 'UPDATE') or has_table_privilege('authenticated', v, 'DELETE') then
      raise exception 'SEC-C2: los permisos de % no son los auditados', v;
    end if;
  end loop;
  if md5(pg_get_viewdef('public.v_custody_stock'::regclass)) <> '894b9ed23d36bba674c20c4d0d818551'
     or md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) <> '794c370463acb6d8080883743e587a20' then
    raise exception 'SEC-C2: la definición de las vistas no es la auditada (drift)';
  end if;
  -- El aislamiento descansa en el RLS de estas dos tablas: deben ser exactamente las auditadas.
  if (select bool_and(relrowsecurity) from pg_class where oid in ('public.custodies'::regclass, 'public.custody_lines'::regclass)) is not true then
    raise exception 'SEC-C2: custodies / custody_lines no tienen RLS activo';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'custodies' and policyname = 'custodies_select_ops'
        and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '75bc0009832a1daac1a00b2de519f1b5'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'custody_lines' and policyname = 'custody_lines_select_ops'
        and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}') is distinct from '986084c8d75a2ed1788d8a28a6204dee' then
    raise exception 'SEC-C2: las políticas SELECT de custodia no son las auditadas (drift)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('custodies', 'custody_lines')) <> 2 then
    raise exception 'SEC-C2: hay políticas adicionales (o restrictivas) no auditadas en custodies / custody_lines';
  end if;
  -- Dependencia de la liquidación: v_order_money (filtra por el pedido visible del que consulta) debe ser la auditada.
  if md5(pg_get_viewdef('public.v_order_money'::regclass)) <> '8de543e01ea16278d149d7af9bc98e55' then
    raise exception 'SEC-C2: v_order_money no es la versión auditada (drift)';
  end if;
  if not has_table_privilege('authenticated', 'public.custodies', 'SELECT') or not has_table_privilege('authenticated', 'public.custody_lines', 'SELECT')
     or not has_table_privilege('authenticated', 'public.v_order_money', 'SELECT') then
    raise exception 'SEC-C2: authenticated no tiene SELECT sobre los objetos de debajo (la vista invoker daría permission denied)';
  end if;
end $pre$;

alter view public.v_custody_stock       set (security_invoker = true);
alter view public.v_custody_liquidacion set (security_invoker = true);

do $post$
declare v regclass;
begin
  foreach v in array array['public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass] loop
    if (select reloptions from pg_class where oid = v) is distinct from array['security_invoker=true'] then
      raise exception 'SEC-C2: % no quedó exactamente con security_invoker=true', v;
    end if;
    if (select relowner = 'postgres'::regrole and relkind = 'v' from pg_class where oid = v) is not true
       or not has_table_privilege('authenticated', v, 'SELECT') or not has_table_privilege('service_role', v, 'SELECT') or has_table_privilege('anon', v, 'SELECT') then
      raise exception 'SEC-C2: cambió el dueño o los permisos de %', v;
    end if;
  end loop;
  if md5(pg_get_viewdef('public.v_custody_stock'::regclass)) <> '894b9ed23d36bba674c20c4d0d818551'
     or md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) <> '794c370463acb6d8080883743e587a20' then
    raise exception 'SEC-C2: cambió la definición de una vista (no permitido)';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'custodies' and policyname = 'custodies_select_ops') <> '75bc0009832a1daac1a00b2de519f1b5'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'custody_lines' and policyname = 'custody_lines_select_ops') <> '986084c8d75a2ed1788d8a28a6204dee'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename in ('custodies', 'custody_lines')) <> 2 then
    raise exception 'SEC-C2: cambiaron las políticas de custodia (no permitido)';
  end if;
end $post$;
