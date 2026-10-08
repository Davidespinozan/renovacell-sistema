-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- SEC-A (migración 138) · CX-SEC-01 / F3 · EXPOSICIÓN DE IDENTIDAD DE PEDIDOS
--   Hallazgo (auditado y reproducido en cluster desechable): order_owner(uuid) y order_vendor_email(uuid) son SECURITY
--   DEFINER y devolvían el comprador / el meta.owner de CUALQUIER pedido a quien las ejecutara: anon (por los privilegios por
--   defecto PUBLIC + grant explícito) y cualquier autenticado sin relación. Además, null vs no-null revelaba si un pedido existe.
--   Contrato nuevo (mismo nombre, esquema, firma, retorno, STABLE, SECURITY DEFINER y search_path):
--     · order_owner(o)        → doctor_id SOLO si es el llamador (auth.uid()); si no, NULL.
--     · order_vendor_email(o) → meta.owner SOLO si coincide con el correo del JWT del llamador; si no, NULL.
--   Por qué así (evidencia del diseño): ambas se evalúan DENTRO de políticas RLS con la identidad del que consulta
--     · shipments.shipments_select_scoped:  order_owner(order_id) = auth.uid()
--     · orders.orders_select_scoped (CX-0c): order_vendor_email(id) = auth.jwt() ->> 'email'
--   Quitar EXECUTE a authenticated rompe shipments y orders para TODOS (probado). Con el contrato nuevo esas comparaciones dan
--   exactamente el mismo resultado que antes para cada actor, sin devolver datos ajenos. Las políticas NO se tocan.
--   Permisos: sin PUBLIC ni anon; authenticated y service_role conservan EXECUTE. service_role tiene BYPASSRLS (las políticas no
--   se evalúan para él) y ninguna función, vista, Edge Function ni frontend llama a estas funciones: su resultado directo pasa a
--   NULL sin consumidores afectados (verificado).
--   Sin cambios de datos, tablas ni políticas. Rollback: supabase/rollback/sec_a/99_down.sql (REABRE la exposición).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.order_owner(uuid)'::regprocedure)) <> '275ca1cc439c1fe13e1610d0eab21416'
     or md5(pg_get_functiondef('public.order_vendor_email(uuid)'::regprocedure)) <> 'b7de05a551bc0482e8421203949bc2a5' then
    raise exception 'SEC-A: order_owner / order_vendor_email no son la versión esperada (ya aplicada o drift en producción)';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') is distinct from '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') is distinct from '457f39b6ea229576071c7c7f4f4a389d' then
    raise exception 'SEC-A: las políticas que dependen de estas funciones no son las esperadas (drift)';
  end if;
end $pre$;

create or replace function public.order_owner(o_id uuid) returns uuid
  language sql stable security definer set search_path = public as
$$ select o.doctor_id from public.orders o where o.id = o_id and o.doctor_id = auth.uid() $$;
comment on function public.order_owner(uuid) is
  'SEC-A · Comprador del pedido SOLO si es el llamador (auth.uid()); NULL en cualquier otro caso (no revela comprador ni existencia). Usada por shipments_select_scoped.';

create or replace function public.order_vendor_email(o_id uuid) returns text
  language sql stable security definer set search_path = public as
$$ select p.meta ->> 'owner' from public.orders o join public.profiles p on p.id = o.doctor_id
   where o.id = o_id and (p.meta ->> 'owner') = (auth.jwt() ->> 'email') $$;
comment on function public.order_vendor_email(uuid) is
  'SEC-A · meta.owner del pedido SOLO si coincide con el correo del JWT del llamador; NULL en cualquier otro caso. Ruta heredada de orders_select_scoped.';

revoke all on function public.order_owner(uuid) from public, anon;
revoke all on function public.order_vendor_email(uuid) from public, anon;
grant execute on function public.order_owner(uuid) to authenticated, service_role;
grant execute on function public.order_vendor_email(uuid) to authenticated, service_role;

do $post$ begin
  if has_function_privilege('anon', 'public.order_owner(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.order_vendor_email(uuid)', 'EXECUTE') then
    raise exception 'SEC-A: anon conserva EXECUTE';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid in ('public.order_owner(uuid)'::regprocedure, 'public.order_vendor_email(uuid)'::regprocedure) and a.grantee = 0) then
    raise exception 'SEC-A: PUBLIC conserva EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.order_owner(uuid)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.order_vendor_email(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.order_owner(uuid)', 'EXECUTE') or not has_function_privilege('service_role', 'public.order_vendor_email(uuid)', 'EXECUTE') then
    raise exception 'SEC-A: authenticated/service_role perdieron EXECUTE (rompería shipments/orders)';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') <> '5726c48548f6e0d9e6d69f5205bdc64b'
     or (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') <> '457f39b6ea229576071c7c7f4f4a389d' then
    raise exception 'SEC-A: cambió una política (no permitido)';
  end if;
  if (select prosecdef and provolatile = 's' and proconfig @> array['search_path=public'] and prorettype = 'uuid'::regtype from pg_proc where oid = 'public.order_owner(uuid)'::regprocedure) is not true
     or (select prosecdef and provolatile = 's' and proconfig @> array['search_path=public'] and prorettype = 'text'::regtype from pg_proc where oid = 'public.order_vendor_email(uuid)'::regprocedure) is not true then
    raise exception 'SEC-A: cambió la forma de las funciones (SECURITY DEFINER / STABLE / search_path / retorno)';
  end if;
end $post$;
