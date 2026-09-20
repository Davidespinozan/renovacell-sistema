-- P0 SEGURIDAD (auditoría Alberto, commit 6dc228c). Cierra 4 hallazgos críticos de BD:
--   R-01  Las guardas de rol "fallan abierto": auth_role() devuelve NULL sin sesión y
--         `IF NOT (NULL = ANY ...)` no lanza. Se redefine auth_role() para devolver ''
--         (cadena vacía) → toda guarda con = ANY / <> ALL ahora falla CERRADO. Esto también
--         cierra el P1 latente de crear_pedido/vender_pos.
--   R-02  pay_order autorizaba al DUEÑO del pedido (o.doctor_id = auth.uid()): un doctor
--         marcaba su propio pedido como pagado sin pagar. Ahora solo staff de cobro.
--   A-02  order_items permitía al doctor UPDATE/DELETE de sus renglones en cualquier estado
--         (alterar qty/unit_price → total/CFDI). Se quita la rama del doctor (solo staff).
--   R-03  proofs_read exponía TODO el bucket (incluye identity/ = selfie+INE y transfers/ =
--         comprobantes bancarios) a cualquier staff no-doctor. Se restringe lo sensible a
--         admin/billing/comm; las fotos de entrega (prefijo proofs/) siguen para staff.
-- Solo lectura del dominio: no borra datos. Idempotente. Self-test al final aborta si falla.

-- ── R-01 ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role_id from public.profiles where id = auth.uid()), '');
$$;

-- ── R-02 ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.pay_order(p_order uuid, p_method text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Pedido no existe'; end if;
  -- Solo staff de cobro. El doctor NO marca su propio pedido pagado (paga por transferencia
  -- vía report-transfer → lo confirma el staff, o por Stripe → lo marca el webhook server-side).
  if not (public.auth_role() = any (array['admin','billing','pos','warehouse','packing'])) then
    raise exception 'No autorizado para cobrar este pedido';
  end if;
  perform set_config('app.trusted','on', true);
  update public.orders
     set payment_status='paid', payment_method=p_method, payment_ref=p_ref,
         status = case when status='pending_payment' then 'paid' else status end
   where id = p_order;
end; $$;
revoke all on function public.pay_order(uuid, text, text) from public, anon;
grant execute on function public.pay_order(uuid, text, text) to authenticated;

-- ── A-02 ──────────────────────────────────────────────────────────────────────────────────
drop policy if exists order_items_update_scoped on public.order_items;
create policy order_items_update_scoped on public.order_items
  for update to authenticated
  using  ( public.auth_role() = any (array['admin','warehouse','packing']) )
  with check ( public.auth_role() = any (array['admin','warehouse','packing']) );

drop policy if exists order_items_delete_scoped on public.order_items;
create policy order_items_delete_scoped on public.order_items
  for delete to authenticated
  using ( public.auth_role() = 'admin' );

-- ── R-03 ──────────────────────────────────────────────────────────────────────────────────
-- Sensible (identity/ = selfie+INE, transfers/ = comprobantes bancarios): solo oficina.
-- Entregas (prefijo proofs/, sube el chofer): cualquier staff no-doctor (para su preview y
-- el visor de Seguimiento). Doctores: nada.
drop policy if exists proofs_read on storage.objects;
create policy proofs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs' and (
      public.auth_role() = any (array['admin','billing','comm'])
      or ( (storage.foldername(name))[1] = 'proofs' and public.auth_role() <> 'doctor' )
    )
  );

-- ── SELF-TEST (aborta el deploy si algún fix no quedó) ──────────────────────────────────────
do $$
declare def text;
begin
  -- R-01: sin sesión auth.uid() es null → auth_role() debe ser '' (no null) para fallar cerrado.
  if public.auth_role() is distinct from '' then
    raise exception 'P0-SEG: auth_role() debe devolver '''' sin sesión (R-01), devolvió %', coalesce(public.auth_role(),'<null>');
  end if;
  -- R-02: pay_order ya no debe autorizar por dueño del pedido.
  select pg_get_functiondef('public.pay_order(uuid,text,text)'::regprocedure) into def;
  if def ilike '%doctor_id = auth.uid()%' then
    raise exception 'P0-SEG: pay_order todavía autoriza al doctor (R-02)';
  end if;
  -- A-02: la política de UPDATE de order_items ya no debe referirse a doctor_id.
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='order_items' and policyname='order_items_update_scoped'
      and coalesce(qual,'') || coalesce(with_check,'') ilike '%doctor_id%'
  ) then
    raise exception 'P0-SEG: order_items_update_scoped todavía permite al doctor (A-02)';
  end if;
  -- R-03: proofs_read ya no debe ser un simple "<> doctor" sin distinguir prefijo sensible.
  if exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='proofs_read'
      and coalesce(qual,'') not ilike '%foldername%'
  ) then
    raise exception 'P0-SEG: proofs_read no distingue prefijo sensible (R-03)';
  end if;
end $$;
