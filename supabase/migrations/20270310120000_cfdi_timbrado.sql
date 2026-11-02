-- ============================================================================
-- TIMBRADO REAL (2 nov 2026, dueño: "ponerlo en live sin las claves pero que no puedan facturar hasta que pongan las
-- claves"). La compuerta es POR PEDIDO: un pedido solo se timbra si todos sus productos (y su envío, si lo cobró) tienen
-- la configuración fiscal VALIDADA por una persona. Lo demás de W3 (intención durable, reclamo con serie/folio/Date,
-- clasificación timbrado/fallido/incierto, conciliación y adopción) ya existe y no se toca.
--   · fiscal_concepto_envio: el flete también es un concepto del CFDI; se configura y se valida igual que un producto.
--   · cfdi_preparar(doc): una lectura con TODO lo que la Edge `cfdi` necesita para armar el comprobante (receptor
--     congelado, renglones con su configuración fiscal, envío, cobros por método, emisor) y la lista de lo que FALTA.
--     No reclama folio ni escribe nada: si falta algo, no se consume folio.
-- ============================================================================
create table if not exists public.fiscal_concepto_envio (
  id text primary key default 'envio' check (id = 'envio'),
  clave_prod_serv text check (clave_prod_serv is null or clave_prod_serv ~ '^[0-9]{8}$'),
  clave_unidad text check (clave_unidad is null or clave_unidad ~ '^[A-Z0-9]{1,3}$'),
  objeto_imp text check (objeto_imp is null or objeto_imp in ('01', '02', '03')),
  tratamiento_iva text check (tratamiento_iva is null or tratamiento_iva in ('gravado', 'tasa_cero', 'exento', 'no_objeto')),
  iva_tasa numeric(8,6),
  descripcion_fiscal text,
  validado boolean not null default false,
  validado_por uuid references auth.users(id),
  validado_at timestamptz,
  fuente text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint ck_envio_tasa check ((tratamiento_iva = 'gravado' and iva_tasa > 0) or (tratamiento_iva = 'tasa_cero' and iva_tasa = 0)
                                  or (tratamiento_iva in ('exento', 'no_objeto') and iva_tasa is null) or tratamiento_iva is null),
  constraint ck_envio_objeto check (public._pf_objeto_coherente(objeto_imp, tratamiento_iva)),
  constraint ck_envio_validado check (not validado or (clave_prod_serv is not null and clave_unidad is not null and objeto_imp is not null
                                      and tratamiento_iva is not null and nullif(btrim(coalesce(descripcion_fiscal, '')), '') is not null
                                      and validado_por is not null and validado_at is not null))
);
alter table public.fiscal_concepto_envio enable row level security;
revoke all on public.fiscal_concepto_envio from public, anon, authenticated;

create or replace function public.fiscal_concepto_envio_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_ENVIO_SOLO_POR_COMANDO' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then raise exception 'FISCAL_ENVIO_NO_SE_BORRA' using errcode = 'check_violation'; end if;
  -- Igual que product_fiscal: cambiar un dato fiscal de algo validado lo devuelve a "por validar".
  if tg_op = 'UPDATE' and old.validado and new.validado and (new.clave_prod_serv, new.clave_unidad, new.objeto_imp, new.tratamiento_iva, new.iva_tasa, new.descripcion_fiscal)
       is distinct from (old.clave_prod_serv, old.clave_unidad, old.objeto_imp, old.tratamiento_iva, old.iva_tasa, old.descripcion_fiscal) then
    new.validado := false; new.validado_por := null; new.validado_at := null;
  end if;
  new.updated_at := now();
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists fiscal_concepto_envio_guard on public.fiscal_concepto_envio;
create trigger fiscal_concepto_envio_guard before insert or update or delete on public.fiscal_concepto_envio
  for each row execute function public.fiscal_concepto_envio_guard();

create or replace function public.fiscal_envio_ver() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._pf_autorizar();
  return (select to_jsonb(e) - 'updated_by' from public.fiscal_concepto_envio e where id = 'envio');
end;
$$;

-- Guarda los datos fiscales del envío (Dirección/Facturación). Solo las llaves que vengan; vacío = null.
create or replace function public.fiscal_envio_guardar(p_cambios jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_trusted text := coalesce(current_setting('app.trusted', true), ''); k text; e public.fiscal_concepto_envio;
begin
  perform public._pf_autorizar();
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then raise exception 'SIN_CAMBIOS' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_cambios) loop
    if k not in ('clave_prod_serv', 'clave_unidad', 'objeto_imp', 'tratamiento_iva', 'iva_tasa', 'descripcion_fiscal') then
      raise exception 'CAMPO_FISCAL_DESCONOCIDO: %', k using errcode = 'check_violation';
    end if;
  end loop;
  perform set_config('app.trusted', 'on', true);
  insert into public.fiscal_concepto_envio (id, updated_by) values ('envio', auth.uid()) on conflict (id) do nothing;
  update public.fiscal_concepto_envio set
    clave_prod_serv = case when p_cambios ? 'clave_prod_serv' then nullif(btrim(p_cambios ->> 'clave_prod_serv'), '') else clave_prod_serv end,
    clave_unidad = case when p_cambios ? 'clave_unidad' then upper(nullif(btrim(p_cambios ->> 'clave_unidad'), '')) else clave_unidad end,
    objeto_imp = case when p_cambios ? 'objeto_imp' then nullif(btrim(p_cambios ->> 'objeto_imp'), '') else objeto_imp end,
    tratamiento_iva = case when p_cambios ? 'tratamiento_iva' then nullif(btrim(p_cambios ->> 'tratamiento_iva'), '') else tratamiento_iva end,
    iva_tasa = case when p_cambios ? 'iva_tasa' then nullif(btrim(p_cambios ->> 'iva_tasa'), '')::numeric else iva_tasa end,
    descripcion_fiscal = case when p_cambios ? 'descripcion_fiscal' then nullif(btrim(p_cambios ->> 'descripcion_fiscal'), '') else descripcion_fiscal end,
    updated_by = auth.uid()
   where id = 'envio' returning * into e;
  perform set_config('app.trusted', v_trusted, true);
  return to_jsonb(e) - 'updated_by';
end;
$$;

-- Validación HUMANA (igual que un producto): exige la cuenta de quien valida.
create or replace function public.fiscal_envio_validar(p_fuente text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_trusted text := coalesce(current_setting('app.trusted', true), ''); e public.fiscal_concepto_envio;
begin
  perform public._pf_autorizar();
  if auth.uid() is null then raise exception 'VALIDACION_HUMANA: la valida una persona de Dirección o Facturación' using errcode = 'insufficient_privilege'; end if;
  if nullif(btrim(coalesce(p_fuente, '')), '') is null then raise exception 'FUENTE_REQUERIDA' using errcode = 'check_violation'; end if;
  select * into e from public.fiscal_concepto_envio where id = 'envio';
  if not found then raise exception 'FISCAL_ENVIO_SIN_CONFIGURAR' using errcode = 'check_violation'; end if;
  perform set_config('app.trusted', 'on', true);
  update public.fiscal_concepto_envio set validado = true, validado_por = auth.uid(), validado_at = now(), fuente = left(btrim(p_fuente), 200), updated_by = auth.uid()
   where id = 'envio' returning * into e;
  perform set_config('app.trusted', v_trusted, true);
  return to_jsonb(e) - 'updated_by';
end;
$$;

-- Todo lo que hace falta para timbrar un documento fiscal, y lo que falta. Solo lectura.
create or replace function public.cfdi_preparar(p_doc uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare d public.fiscal_documents; o record; cs record; env public.fiscal_concepto_envio; v_falta text[] := '{}'; v_lineas jsonb; v_cobros jsonb; v_suma numeric;
begin
  perform public._pf_autorizar();
  select * into d from public.fiscal_documents where id = p_doc;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  select x.id, x.external_ref, x.status, x.payment_status, x.total, coalesce(x.shipping_cost, 0) shipping_cost, coalesce(x.currency, 'MXN') currency into o
    from public.orders x where x.id = d.order_id;
  select razon_social, rfc, regimen_fiscal, cp into cs from public.company_settings where id = 'default';
  select * into env from public.fiscal_concepto_envio where id = 'envio';

  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sku', p.sku, 'nombre', p.name, 'qty', i.qty, 'unit_price', i.unit_price,
           'clave_prod_serv', f.clave_prod_serv, 'clave_unidad', f.clave_unidad, 'objeto_imp', f.objeto_imp, 'tratamiento_iva', f.tratamiento_iva,
           'iva_tasa', f.iva_tasa, 'descripcion_fiscal', f.descripcion_fiscal, 'validado', coalesce(f.validado, false)) order by i.created_at, i.id), '[]'::jsonb),
         coalesce(sum(i.qty * i.unit_price), 0)
    into v_lineas, v_suma
    from public.order_items i join public.products p on p.id = i.product_id left join public.product_fiscal f on f.product_id = i.product_id
   where i.order_id = d.order_id;
  select coalesce(jsonb_agg(jsonb_build_object('method', m, 'amount', a) order by a desc), '[]'::jsonb) into v_cobros
    from (select e.method m, sum(case when e.direction = 'in' then e.amount else -e.amount end) a
            from public.payment_entries e where e.order_id = d.order_id and e.refund_id is null group by e.method) t where a > 0;

  if d.status <> 'pendiente' then v_falta := v_falta || ('La solicitud está en estado ' || d.status || '.'); end if;
  if o.status = 'cancelled' then v_falta := v_falta || 'El pedido está cancelado.'::text; end if;
  if o.payment_status <> 'paid' then v_falta := v_falta || 'El pedido debe estar pagado.'::text; end if;
  if nullif(btrim(coalesce(cs.rfc, '')), '') is null or nullif(btrim(coalesce(cs.razon_social, '')), '') is null
     or nullif(btrim(coalesce(cs.regimen_fiscal, '')), '') is null or coalesce(cs.cp, '') !~ '^[0-9]{5}$' then
    v_falta := v_falta || 'Faltan datos fiscales del emisor (Configuración): RFC, razón social, régimen o CP.'::text;
  end if;
  v_falta := v_falta || coalesce((select array_agg(x.nombre || ': falta ' || array_to_string(x.faltantes, ', ') order by x.nombre) from public.pedido_fiscalmente_listo(d.order_id) x), '{}');
  if o.shipping_cost > 0 and not coalesce(env.validado, false) then
    v_falta := v_falta || 'Envío: configura y valida su clave SAT en Revisión fiscal.'::text;
  end if;
  if abs(v_suma + o.shipping_cost - o.total) > 0.005 then
    v_falta := v_falta || ('El total del pedido (' || o.total || ') no cuadra con sus renglones más el envío (' || (v_suma + o.shipping_cost) || '): revísalo antes de facturar.');
  end if;

  return jsonb_build_object('doc_id', d.id, 'status', d.status, 'receiver', d.receiver,
    'order', jsonb_build_object('id', o.id, 'folio', o.external_ref, 'status', o.status, 'payment_status', o.payment_status, 'total', o.total, 'shipping_cost', o.shipping_cost, 'currency', o.currency),
    'lineas', v_lineas,
    'envio', case when o.shipping_cost > 0 and env.id is not null then jsonb_build_object('clave_prod_serv', env.clave_prod_serv, 'clave_unidad', env.clave_unidad,
               'objeto_imp', env.objeto_imp, 'tratamiento_iva', env.tratamiento_iva, 'iva_tasa', env.iva_tasa, 'descripcion_fiscal', env.descripcion_fiscal, 'validado', env.validado) end,
    'cobros', v_cobros,
    'emisor', jsonb_build_object('rfc', upper(btrim(coalesce(cs.rfc, ''))), 'razon_social', cs.razon_social, 'regimen_fiscal', cs.regimen_fiscal, 'cp', cs.cp),
    'faltantes', to_jsonb(v_falta), 'listo', coalesce(array_length(v_falta, 1), 0) = 0);
end;
$$;

do $g$ begin
  execute 'revoke all on function public.fiscal_envio_ver(), public.fiscal_envio_guardar(jsonb), public.fiscal_envio_validar(text), public.cfdi_preparar(uuid) from public, anon';
  execute 'grant execute on function public.fiscal_envio_ver(), public.fiscal_envio_guardar(jsonb), public.fiscal_envio_validar(text), public.cfdi_preparar(uuid) to authenticated, service_role';
end $g$;
