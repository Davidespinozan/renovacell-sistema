-- ============================================================================
-- W3-A · F1 — INTENCIÓN FISCAL DURABLE.
--
--  · Registro de idempotencia                        fiscal_operations
--  · La INTENCIÓN fiscal, durable y con identidad    fiscal_documents
--  · Bitácora append-only de transiciones            fiscal_document_events
--  · Máquina de estados (transiciones congeladas)    _w3_transicion_valida()
--  · Huella material de la solicitud                 _w3_fingerprint()
--
-- Principios (diseño W3 congelado):
--   H-1 El SAT es la única autoridad sobre la EXISTENCIA de un CFDI; su evidencia
--       es el UUID del Timbre Fiscal Digital. Renovacell es autoridad sobre la
--       INTENCIÓN: qué quiso facturar, de qué pedido y con qué receptor.
--   H-2 Nada se timbra sin una intención durable escrita ANTES de salir al PAC.
--   H-3 `orders.invoice_meta` deja de ser la verdad y pasa a ser una PROYECCIÓN
--       de fiscal_documents (mismo papel que payment_status respecto del libro).
--   H-4 TIMEOUT / ERROR DE RED ≠ "NO SE TIMBRÓ". El estado `incierto` existe desde
--       W3-A aunque su reconciliación contra el PAC llegue en W3-B/D.
--   H-5 `timbrado` ⇒ UUID presente y con forma de UUID fiscal. Por constraint, no
--       por convención: es lo que hace estructuralmente imposible el P0 actual.
--   H-6 La historia no se edita ni se borra: cada transición deja una fila.
--   H-7 Aquí NO se llama a Facturama, no se timbra y no se cancela. W3-A cambia el
--       camino de "peligroso" a "seguro pero todavía no activado".
--
-- Nada de secretos en la base: ni credenciales, ni Basic auth, ni cabeceras, ni
-- cuerpos crudos del proveedor. `evidence` va saneada y acotada.
-- Las constraints van en F2, los comandos en F3, el cierre de autoridad en F4.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Registro de operaciones fiscales (gemelo de inventory_operations,
--    money_operations y custody_operations). Separado a propósito: W1, W2 y
--    W2-C quedan intactos.
-- ---------------------------------------------------------------------------
create table public.fiscal_operations (
  op_id      uuid primary key,
  kind       text not null check (kind in (
               'cfdi_solicitado','cfdi_actualizado','cfdi_descartado',
               'cfdi_reclamado','cfdi_timbrado','cfdi_fallido','cfdi_incierto',
               'cfdi_conciliado','cfdi_cancelado')),
  actor      uuid,
  actor_role text not null default '',
  request    jsonb not null,
  result     jsonb,
  created_at timestamptz not null default now()
);
comment on table public.fiscal_operations is
  'Idempotencia de las operaciones fiscales: un op_id = una operación. Un reintento devuelve el resultado ya registrado, nunca produce un segundo efecto.';

-- ---------------------------------------------------------------------------
-- 2) LA INTENCIÓN FISCAL. Existe desde que se solicita la factura, mucho antes
--    de que exista un CFDI. Su identidad es estable y sobrevive a cualquier
--    fallo de red, de plataforma o de cliente.
-- ---------------------------------------------------------------------------
create table public.fiscal_documents (
  id                  uuid primary key,          -- = op_id de la solicitud
  order_id            uuid not null references public.orders(id) on delete restrict,
  kind                text not null default 'ingreso',
  status              text not null default 'pendiente',

  -- Qué se pidió timbrar (autoridad de la intención).
  request_fingerprint text,
  receiver            jsonb not null,
  subtotal            numeric,
  iva                 numeric,
  total               numeric,
  currency            text,
  forma_pago          text,                      -- se deriva del libro de W2 en W3-C
  metodo_pago         text,                      -- idem

  -- Proveedor y entorno. `provider_env` se guarda en CADA documento para que un
  -- timbre de sandbox no pueda confundirse nunca con uno real.
  provider            text not null default 'facturama',
  provider_env        text,
  provider_ref        text,

  -- Evidencia del SAT. Solo la escribe el comando, y solo con prueba válida.
  uuid                text,
  serie               text,
  folio               text,
  provider_stamped_at timestamptz,

  -- Reclamo atómico (un solo worker gana la intención).
  claim_id            uuid,
  claimed_at          timestamptz,
  claimed_by          uuid,
  attempts            integer not null default 0,

  error_code          text,
  error_message       text,

  actor               uuid,
  actor_role          text not null default '',
  op_id               uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  reconciled_at       timestamptz,
  reconcile_note      text
);
comment on table public.fiscal_documents is
  'Intención fiscal durable por pedido. Se escribe ANTES de cualquier salida al PAC y sobrevive a timeouts, caídas y fallos del cliente. orders.invoice_meta es su proyección, no su verdad.';
comment on column public.fiscal_documents.status is
  'pendiente · en_proceso · timbrado · fallido · incierto · cancelado. `fallido` = se demuestra que el PAC no produjo efecto (reintentable). `incierto` = pudo haberlo producido (NO reintentable: se concilia).';
comment on column public.fiscal_documents.uuid is
  'UUID del Timbre Fiscal Digital. Única prueba de que el CFDI existe. Solo proviene del PAC (respuesta o consulta), nunca del cliente ni de la UI.';
comment on column public.fiscal_documents.provider_env is
  'sandbox | produccion. Obligatorio en cuanto existe UUID: la conciliación solo compara contra el mismo entorno.';
comment on column public.fiscal_documents.request_fingerprint is
  'Huella determinista de lo material de la solicitud, versionada (w3a-1:<md5>). Detecta que cambió el contenido a timbrar. NO incluye forma/método de pago ni claves SAT por producto: dependen de decisiones fiscales abiertas (D-W3-1…6) y se integran en W3-C.';
comment on column public.fiscal_documents.receiver is
  'Receptor fiscal efectivamente confirmado para ESTE comprobante. Congelado: no se recalcula ni se pierde si luego cambia el maestro del cliente.';

create index idx_fiscal_doc_order  on public.fiscal_documents(order_id);
create index idx_fiscal_doc_status on public.fiscal_documents(status);
create index idx_fiscal_doc_abiertos on public.fiscal_documents(status, claimed_at)
  where status in ('en_proceso','incierto');

-- ---------------------------------------------------------------------------
-- 3) BITÁCORA de transiciones — append-only (H-6). Ninguna transición de estado
--    puede ocurrir sin dejar su fila: lo garantiza la guarda del punto 5, que
--    solo admite cambios de `status` dentro de _w3_transicion().
-- ---------------------------------------------------------------------------
create table public.fiscal_document_events (
  id                 uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  from_status        text,
  to_status          text not null,
  event              text not null,
  reason             text,
  evidence           jsonb,
  actor              uuid,
  actor_role         text not null default '',
  op_id              uuid,
  created_at         timestamptz not null default clock_timestamp()
);
comment on table public.fiscal_document_events is
  'Historia completa de la intención fiscal. Append-only: no se edita ni se borra. `evidence` va SANEADA (sin credenciales, sin cabeceras, sin cuerpos crudos del proveedor).';

create index idx_fiscal_events_doc on public.fiscal_document_events(fiscal_document_id, created_at);

-- Append-only (reusa la guarda del libro de W1/W2/W2-C: una sola disciplina).
create trigger trg_fiscal_events_append_only before update or delete on public.fiscal_document_events
  for each row execute function public.ledger_append_only();
create trigger trg_fiscal_events_no_truncate before truncate on public.fiscal_document_events
  for each statement execute function public.ledger_append_only();
create trigger trg_fiscal_operations_append_only before update or delete on public.fiscal_operations
  for each row execute function public.ledger_append_only();
create trigger trg_fiscal_operations_no_truncate before truncate on public.fiscal_operations
  for each statement execute function public.ledger_append_only();
create trigger trg_fiscal_documents_no_truncate before truncate on public.fiscal_documents
  for each statement execute function public.ledger_append_only();

-- ---------------------------------------------------------------------------
-- 4) MÁQUINA DE ESTADOS — transiciones congeladas.
--
--   pendiente ─claim─► en_proceso ─evidencia válida─► timbrado ─►  cancelado
--                          │
--                          ├─ error inequívoco SIN efecto ─► fallido
--                          └─ timeout · red · ambiguo · falla al persistir ─► incierto
--   incierto ─SOLO por conciliación contra el PAC─► timbrado | fallido
--
-- `incierto` NO vuelve a `en_proceso`: de un estado ambiguo no se reintenta.
-- ---------------------------------------------------------------------------
create function public._w3_transicion_valida(p_from text, p_to text) returns boolean
  language sql immutable set search_path = public as
$$
  select (p_from, p_to) in (
    ('pendiente',  'en_proceso'),
    ('pendiente',  'fallido'),     -- solicitud descartada antes de salir a ningún PAC
    ('en_proceso', 'timbrado'),
    ('en_proceso', 'fallido'),
    ('en_proceso', 'incierto'),
    ('incierto',   'timbrado'),    -- adopción de timbre huérfano (solo conciliación)
    ('incierto',   'fallido'),     -- el PAC no lo tiene (solo conciliación)
    ('timbrado',   'cancelado')
  );
$$;
comment on function public._w3_transicion_valida(text, text) is
  'Transiciones permitidas de la intención fiscal. Cualquier otra se rechaza, incluso desde el dueño de la base.';

-- ---------------------------------------------------------------------------
-- 5) GUARDA de la intención: solo los comandos escriben, la historia nunca se
--    pierde y la evidencia fiscal no se reescribe.
-- ---------------------------------------------------------------------------
create function public.fiscal_documents_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    raise exception 'FISCAL_NO_SE_BORRA: un documento fiscal no se elimina; es evidencia. Se cancela o se concilia.'
      using errcode = 'check_violation';
  end if;

  -- Fuera del contexto de comando, nadie escribe: ni cliente, ni Dirección, ni el
  -- dueño de la base. La evidencia fiscal no se edita a mano.
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_SOLO_POR_COMANDO: la evidencia fiscal se registra con los comandos del servidor, no editando la tabla.'
      using errcode = 'check_violation';
  end if;

  -- Identidad inmutable.
  if new.id <> old.id or new.order_id <> old.order_id or new.kind <> old.kind
     or new.created_at <> old.created_at then
    raise exception 'FISCAL_IDENTIDAD_INMUTABLE: no se cambia el pedido ni el tipo de un documento fiscal.'
      using errcode = 'check_violation';
  end if;

  -- Todo cambio de estado pasa por _w3_transicion(): así ninguna transición se
  -- queda sin su fila en la bitácora (H-6).
  if new.status is distinct from old.status
     and coalesce(current_setting('renovacell.w3_transicion', true), '') <> 'on' then
    raise exception 'FISCAL_TRANSICION_SOLO_POR_COMANDO: el estado fiscal cambia con la transición registrada, no con un UPDATE directo.'
      using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status
     and not public._w3_transicion_valida(old.status, new.status) then
    raise exception 'FISCAL_TRANSICION_INVALIDA: % → % no es una transición permitida.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- La evidencia del SAT se escribe UNA vez y no se reescribe ni se borra.
  if old.uuid is not null and new.uuid is distinct from old.uuid then
    raise exception 'FISCAL_UUID_INMUTABLE: el UUID del SAT ya registrado no se reescribe (%).', old.uuid
      using errcode = 'check_violation';
  end if;
  if old.uuid is not null and new.provider_env is distinct from old.provider_env then
    raise exception 'FISCAL_ENTORNO_INMUTABLE: el entorno de un comprobante ya timbrado no cambia.'
      using errcode = 'check_violation';
  end if;

  -- Lo que se pidió timbrar solo puede corregirse mientras la solicitud sigue
  -- pendiente. Después es el contenido que salió (o pudo salir) al PAC.
  if old.status <> 'pendiente'
     and (new.receiver is distinct from old.receiver
          or new.request_fingerprint is distinct from old.request_fingerprint) then
    raise exception 'FISCAL_SOLICITUD_CONGELADA: el contenido de la solicitud ya no se modifica en estado %.', old.status
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_fiscal_documents_guard before update or delete on public.fiscal_documents
  for each row execute function public.fiscal_documents_guard();

-- ---------------------------------------------------------------------------
-- 6) HUELLA MATERIAL de la solicitud — determinista y server-side.
--
--    Incluye HOY lo que está congelado: receptor canónico, renglones (producto,
--    cantidad, precio unitario), total, moneda y el pedido. Cambiar una coma en
--    un nombre no es material; cambiar RFC, cantidad o importe sí.
--
--    PENDIENTE PARA W3-C (a propósito, no por olvido): forma de pago y método de
--    pago derivados del libro de W2, ClaveProdServ por producto, descripción
--    fiscal por renglón y tasa de IVA por producto. Dependen de D-W3-1…D-W3-6 y
--    NO se inventan defaults para completar la huella. La versión del prefijo
--    cambia cuando se integren, de modo que la diferencia sea detectable.
-- ---------------------------------------------------------------------------
create function public._w3_fingerprint(p_order uuid, p_receiver jsonb) returns text
  language sql stable security definer set search_path = public as
$$
  select 'w3a-1:' || md5(
    coalesce(public._fiscal_clean(p_receiver)::text, '') || '|' ||
    coalesce((select o.total::text  from public.orders o where o.id = p_order), '') || '|' ||
    coalesce((select o.currency     from public.orders o where o.id = p_order), 'MXN') || '|' ||
    coalesce((select string_agg(i.product_id::text || 'x' || i.qty::text || '@' || i.unit_price::text, ';'
                                order by i.product_id, i.qty, i.unit_price)
                from public.order_items i where i.order_id = p_order), '')
  );
$$;
comment on function public._w3_fingerprint(uuid, jsonb) is
  'Huella determinista de lo material de la solicitud fiscal, versionada. w3a-1 cubre receptor, renglones, total y moneda. Forma/método de pago y claves SAT por producto entran en W3-C (D-W3-1…6 abiertas): no se inventan defaults.';

-- ---------------------------------------------------------------------------
-- 7) RLS. Lectura para Dirección/Facturación; escritura para NADIE por tabla.
--    Los comandos de F3 son SECURITY DEFINER y escriben en su propio contexto.
-- ---------------------------------------------------------------------------
alter table public.fiscal_documents       enable row level security;
alter table public.fiscal_document_events enable row level security;
alter table public.fiscal_operations      enable row level security;

revoke all on public.fiscal_documents, public.fiscal_document_events, public.fiscal_operations
  from anon, authenticated;
grant select on public.fiscal_documents, public.fiscal_document_events, public.fiscal_operations
  to authenticated;

create policy fiscal_documents_select on public.fiscal_documents
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
create policy fiscal_events_select on public.fiscal_document_events
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
create policy fiscal_operations_select on public.fiscal_operations
  for select to authenticated using (public.auth_role() = 'admin');
