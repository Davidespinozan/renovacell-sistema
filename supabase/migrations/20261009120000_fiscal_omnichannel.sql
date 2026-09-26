-- ============================================================================
-- CFDI OMNICANAL · FASE 1 — Perfil fiscal maestro + snapshot por pedido.
--   • customers.meta.fiscal = AUTORIDAD fiscal (una sola fuente omnicanal).
--   • orders.invoice_meta.receiver = SNAPSHOT congelado usado para ESE pedido.
-- Sin columnas nuevas: todo cabe en los jsonb existentes (meta / invoice_meta).
-- Escritura acotada por RPC SECURITY DEFINER (no se amplía RLS de customers/orders).
-- Contrato canónico: { rfc, razon_social, regimen, cp, uso_cfdi, email_facturacion }.
-- ============================================================================

-- ── Validación mínima compartida (no es un motor SAT; Facturama es el juez final) ──────────
create or replace function public._fiscal_error(p jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  rfc   text := upper(btrim(coalesce(p->>'rfc','')));
  razon text := btrim(coalesce(p->>'razon_social',''));
  reg   text := btrim(coalesce(p->>'regimen',''));
  cp    text := btrim(coalesce(p->>'cp',''));
  uso   text := btrim(coalesce(p->>'uso_cfdi',''));
  email text := lower(btrim(coalesce(p->>'email_facturacion','')));
begin
  if rfc = '' then return 'RFC requerido'; end if;
  if length(rfc) not in (12,13) then return 'RFC debe tener 12 (moral) o 13 (física) caracteres'; end if;
  if rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then return 'Formato de RFC no válido'; end if;
  if razon = '' then return 'Razón social requerida'; end if;
  if reg   = '' then return 'Régimen fiscal requerido'; end if;
  if cp    = '' then return 'CP fiscal requerido'; end if;
  if cp !~ '^[0-9]{5}$' then return 'El CP debe tener 5 dígitos'; end if;
  if uso   = '' then return 'Uso de CFDI requerido'; end if;
  if email = '' then return 'Correo de facturación requerido'; end if;
  if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return 'Correo de facturación no válido'; end if;
  return null;
end $$;

-- Deja SOLO las 6 claves canónicas (rfc upper, email lower). Descarta cualquier basura extra.
create or replace function public._fiscal_clean(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'rfc',               upper(btrim(coalesce(p->>'rfc',''))),
    'razon_social',      btrim(coalesce(p->>'razon_social','')),
    'regimen',           btrim(coalesce(p->>'regimen','')),
    'cp',                btrim(coalesce(p->>'cp','')),
    'uso_cfdi',          btrim(coalesce(p->>'uso_cfdi','')),
    'email_facturacion', lower(btrim(coalesce(p->>'email_facturacion','')))
  )
$$;

-- Auditoría enmascarada (nunca RFC/email completos en el log).
create or replace function public._fiscal_audit(p_action text, p_resource text, p_fiscal jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit(
    p_action, p_resource,
    jsonb_build_object('rfc', left(upper(coalesce(p_fiscal->>'rfc','')),4) || '***', 'by', auth.uid())::text,
    'Fiscal'
  );
exception when others then null; -- la auditoría nunca bloquea la operación fiscal
end $$;

-- ── RPC 1: MASTER — escribir SOLO customers.meta.fiscal ───────────────────────────────────
create or replace function public.upsert_customer_fiscal(p_customer_id uuid, p_fiscal jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.auth_role();
  v_err   text;
  v_clean jsonb;
  v_meta  jsonb;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;

  -- Autorización: staff de cobro/venta (cualquiera) o el DOCTOR dueño de ESE customer.
  -- El customer_id del doctor NO se confía: se verifica profile_id = auth.uid() en la BD.
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif exists (select 1 from public.customers where id = p_customer_id and profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este cliente';
  end if;

  v_err := public._fiscal_error(p_fiscal);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_fiscal);

  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;

  -- SOLO toca meta.fiscal. No altera full_name/seller/active/profile_id ni otras claves de meta.
  update public.customers
     set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{fiscal}', v_clean, true),
         updated_at = now()
   where id = p_customer_id;

  perform public._fiscal_audit('Perfil fiscal actualizado', 'customer:' || p_customer_id, v_clean);
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end $$;

-- ── RPC 2: SNAPSHOT — congelar orders.invoice_meta.receiver para ESE pedido ────────────────
create or replace function public.set_order_fiscal_snapshot(p_order_id uuid, p_receiver jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.auth_role();
  v_err   text;
  v_clean jsonb;
  v_meta  jsonb;
  v_doc   uuid;
  v_cust  uuid;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;

  select invoice_meta, doctor_id, customer_id into v_meta, v_doc, v_cust
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización idéntica al master, pero sobre el pedido.
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif v_doc = auth.uid()
     or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este pedido';
  end if;

  -- Un CFDI ya timbrado NO puede cambiar de receptor en silencio (refacturación = otra fase).
  if coalesce(v_meta->>'status','') in ('timbrada','emitida') then
    raise exception 'YA_TIMBRADO: el CFDI ya fue emitido; no se puede cambiar el receptor';
  end if;

  v_err := public._fiscal_error(p_receiver);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_receiver);

  -- Congela el snapshot preservando cualquier otra clave de invoice_meta. Marca la solicitud.
  perform set_config('app.trusted','on', true);
  update public.orders
     set invoice_meta = jsonb_set(coalesce(invoice_meta, '{}'::jsonb), '{receiver}', v_clean, true),
         invoice_requested = true
   where id = p_order_id;

  perform public._fiscal_audit('Snapshot fiscal congelado', 'order:' || p_order_id, v_clean);
  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end $$;

-- ── Grants: helpers privados; RPCs solo para authenticated (no anon) ───────────────────────
revoke all on function public._fiscal_error(jsonb)  from public, anon, authenticated;
revoke all on function public._fiscal_clean(jsonb)  from public, anon, authenticated;
revoke all on function public._fiscal_audit(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_customer_fiscal(uuid, jsonb)  from public, anon;
revoke all on function public.set_order_fiscal_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.upsert_customer_fiscal(uuid, jsonb)  to authenticated;
grant execute on function public.set_order_fiscal_snapshot(uuid, jsonb) to authenticated;
