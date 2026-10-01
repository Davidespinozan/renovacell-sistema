-- ============================================================================
-- W3-B · B1 — IDENTIDAD FISCAL DURABLE ANTE EL PROVEEDOR.
--
-- Hallazgo que ordena esta fase (documentación oficial de Facturama, verificada):
--
--   "Facturama identifica una operación por la combinación de `Folio` y `Date`.
--    Para evitar comprobantes duplicados, ambos valores deben generarse una sola
--    vez al iniciar la operación y reutilizarse sin cambios en cada reintento."
--
--   "No regeneres `Folio` ni `Date` en los reintentos, y no uses la fecha/hora
--    actual del sistema para recalcular `Date`."
--
-- Consecuencias implementadas aquí:
--   J-1 La identidad de la operación ante el PAC es (Folio, Date). Ambos se
--       generan UNA vez y se persisten ANTES de cualquier efecto externo.
--   J-2 `Date` se guarda como el TEXTO EXACTO que se envía. No como timestamptz:
--       una conversión de zona al renderizarlo rompería la llave en silencio, y
--       la idempotencia depende de que el PAC reciba un valor byte-idéntico.
--   J-3 La deduplicación del PAC **no incluye Serie**. Por tanto la unicidad del
--       folio NO puede modelarse solo como (serie, folio): se impone en el
--       ámbito de identidad real ante el proveedor —(provider, entorno, RFC del
--       emisor)— para que una segunda serie futura no pueda reutilizar un folio
--       que colisionaría bajo el contrato verificado.
--   J-4 El RFC del emisor se congela: `GET /cfdi/status` lo exige, y la
--       verificación de un comprobante viejo debe seguir siendo reproducible
--       aunque mañana cambie la configuración de la empresa.
--   J-5 El folio se asigna de un contador TRANSACCIONAL, monótono, nunca
--       aleatorio y nunca reciclado. Un rollback antes de que la intención sea
--       durable libera la asignación (propiedad natural del contador); una vez
--       durable, el folio de esa intención no se reasigna jamás.
--
-- D-W3-4 sigue ABIERTA: aquí no se construye ningún importe ni impuesto.
-- Esta fase NO habilita el timbrado real.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Identidad enviada al proveedor, congelada en el documento.
-- ---------------------------------------------------------------------------
alter table public.fiscal_documents
  add column provider_date_sent text,
  add column issuer_rfc         text;

comment on column public.fiscal_documents.provider_date_sent is
  'El TEXTO EXACTO enviado como `Date` al PAC (YYYY-MM-DDTHH:mm:ss). Junto con folio forma la identidad de la operación: un reintento debe reenviarlo byte-idéntico. No se recalcula nunca desde now().';
comment on column public.fiscal_documents.issuer_rfc is
  'RFC del emisor vigente al reclamar, congelado. Lo exige la consulta de estatus ante el SAT; se guarda para que la conciliación histórica sea reproducible.';
comment on column public.fiscal_documents.folio is
  'Folio de control interno asignado por Renovacell (D-W3-7). Parte de la identidad de la operación ante el PAC. Nunca lo elige el cliente, nunca se recicla.';

-- Formato estricto: es lo que viaja al PAC.
alter table public.fiscal_documents
  add constraint ck_fiscal_date_formato check (
    provider_date_sent is null
    or provider_date_sent ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$');

-- Todo estado que implica que YA hubo reclamo lleva la identidad completa.
-- `fallido` queda fuera: puede venir de un descarte en `pendiente`, que nunca
-- tocó al proveedor y por tanto no tiene identidad asignada.
alter table public.fiscal_documents
  add constraint ck_fiscal_identidad_proveedor check (
    status not in ('en_proceso','timbrado','incierto','cancelado')
    or (serie is not null and folio is not null
        and provider_date_sent is not null and issuer_rfc is not null
        and provider_env is not null));
comment on constraint ck_fiscal_identidad_proveedor on public.fiscal_documents is
  'W3-B · J-1: no existe una intención que haya llegado al proveedor sin su identidad completa y durable (serie, folio, Date, RFC emisor, entorno).';

-- J-3 · UNICIDAD EN EL ÁMBITO REAL DEL PROVEEDOR (sin serie).
create unique index uq_fiscal_folio_proveedor
  on public.fiscal_documents(provider, coalesce(provider_env, ''), coalesce(issuer_rfc, ''), folio)
  where folio is not null;
comment on index public.uq_fiscal_folio_proveedor is
  'W3-B · J-3: un folio no se repite dentro de la identidad del proveedor (proveedor + entorno + RFC emisor), INDEPENDIENTEMENTE de la serie. La deduplicación de Facturama es (Folio, Date) y no incluye serie: modelar la unicidad solo por (serie, folio) sería insuficiente y permitiría una colisión real.';

-- ---------------------------------------------------------------------------
-- 2) Catálogo de series fiscales. D-W3-7: Renovacell usa `REN`.
-- ---------------------------------------------------------------------------
create table public.fiscal_series (
  serie       text primary key,
  provider    text not null default 'facturama',
  activa      boolean not null default true,
  descripcion text,
  created_at  timestamptz not null default now()
);
comment on table public.fiscal_series is
  'Series fiscales válidas. El cliente NUNCA elige la serie: el comando la toma de aquí. Una serie nueva NO reinicia el folio en 1 (ver uq_fiscal_folio_proveedor).';

alter table public.fiscal_series add constraint ck_fiscal_serie_formato
  check (serie ~ '^[A-Z0-9]{1,25}$');
comment on constraint ck_fiscal_serie_formato on public.fiscal_series is
  'Anexo 20 del SAT: la serie acepta de 1 a 25 caracteres alfanuméricos.';

insert into public.fiscal_series (serie, descripcion)
values ('REN', 'Serie fiscal única de Renovacell (decisión de dueño D-W3-7)');

-- ---------------------------------------------------------------------------
-- 3) DOMINIO DE ASIGNACIÓN del folio. Contador transaccional compartido por
--    TODAS las series de un mismo emisor/entorno/proveedor (J-3).
-- ---------------------------------------------------------------------------
create table public.fiscal_folio_domains (
  provider     text   not null,
  provider_env text   not null,
  issuer_rfc   text   not null,
  next_folio   bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (provider, provider_env, issuer_rfc),
  constraint ck_fiscal_folio_dominio_env check (provider_env in ('sandbox','produccion')),
  constraint ck_fiscal_folio_dominio_next check (next_folio >= 1)
);
comment on table public.fiscal_folio_domains is
  'Contador de folios por identidad de proveedor. Transaccional a propósito: un rollback antes de que la intención sea durable libera la asignación, y una vez durable el folio no se reasigna ni se recicla. Los huecos son aceptables (decisión de dueño): no se reutilizan números para taparlos.';

-- ---------------------------------------------------------------------------
-- 4) BITÁCORA DE CONCILIACIÓN — append-only. Es lo que permite DEMOSTRAR, desde
--    la base, que hubo dos sondeos vacíos separados en el tiempo. La separación
--    NO es una convención del frontend: es evidencia persistida.
-- ---------------------------------------------------------------------------
create table public.fiscal_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  probe_kind         text not null,
  outcome            text not null,
  candidates         integer not null default 0,
  uuid_found         text,
  sat_status         text,
  provider_env       text,
  detail             text,
  actor              uuid,
  actor_role         text not null default '',
  op_id              uuid,
  created_at         timestamptz not null default clock_timestamp(),
  constraint ck_fiscal_probe_kind check (probe_kind in
    ('lookup_serie_folio','lookup_order_number','status_uuid','replay')),
  constraint ck_fiscal_probe_outcome check (outcome in
    ('encontrado','vacio','multiple','error','bloqueado')),
  constraint ck_fiscal_probe_candidates check (candidates >= 0),
  constraint ck_fiscal_probe_uuid check (
    uuid_found is null
    or uuid_found ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
comment on table public.fiscal_reconciliations is
  'Sondeos de conciliación contra el proveedor y el SAT. Append-only: es la EVIDENCIA de que se buscó, cuándo y con qué resultado. Sin ella, "dos consultas vacías separadas en el tiempo" sería una promesa del frontend en vez de un hecho verificable. `detail` va saneado: nunca credenciales ni cuerpos crudos.';

create index idx_fiscal_recon_doc on public.fiscal_reconciliations(fiscal_document_id, created_at);

create trigger trg_fiscal_recon_append_only before update or delete on public.fiscal_reconciliations
  for each row execute function public.ledger_append_only();
create trigger trg_fiscal_recon_no_truncate before truncate on public.fiscal_reconciliations
  for each statement execute function public.ledger_append_only();

-- Series y dominios: solo por comando.
create function public.fiscal_numeracion_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') = 'on' then return coalesce(new, old); end if;
  raise exception 'FISCAL_NUMERACION_SOLO_POR_COMANDO: la numeración fiscal la asigna el servidor; no se edita.'
    using errcode = 'check_violation';
end;
$$;
create trigger trg_fiscal_series_guard before insert or update or delete on public.fiscal_series
  for each row execute function public.fiscal_numeracion_guard();
create trigger trg_fiscal_folio_domains_guard before update or delete on public.fiscal_folio_domains
  for each row execute function public.fiscal_numeracion_guard();

-- ---------------------------------------------------------------------------
-- 5) CONSTANTES CENTRALES. Un solo lugar, no números mágicos dispersos.
-- ---------------------------------------------------------------------------
create function public._w3_plazo_timbrado() returns interval
  language sql immutable set search_path = public as $$ select interval '72 hours' $$;
comment on function public._w3_plazo_timbrado() is
  'Plazo del SAT entre la Fecha de la operación y su certificación por el PAC. Frontera legal, no operativa.';

create function public._w3_margen_replay() returns interval
  language sql immutable set search_path = public as $$ select interval '6 hours' $$;
comment on function public._w3_margen_replay() is
  'Margen de seguridad ANTES de la frontera legal de 72 h. Cubre tres cosas que no controlamos: desfase de reloj entre nuestro servidor, el PAC y el SAT; el tiempo de certificación del propio PAC; y la latencia humana entre que la conciliación detecta el caso y Dirección actúa. 6 h es ~8% de la ventana: suficiente para esas tres holguras sin impedir una recuperación el mismo día.';

create function public._w3_ventana_replay() returns interval
  language sql immutable set search_path = public as
$$ select public._w3_plazo_timbrado() - public._w3_margen_replay() $$;
comment on function public._w3_ventana_replay() is
  'Ventana OPERATIVA de reenvío: 66 h desde provider_date_sent. Pasada la ventana, la conciliación por consulta y la adopción siguen permitidas; el POST de reenvío queda bloqueado y NO se genera folio/Date nuevos.';

create function public._w3_edad_minima_sondeo() returns interval
  language sql immutable set search_path = public as $$ select interval '1 hour' $$;
create function public._w3_separacion_sondeos() returns interval
  language sql immutable set search_path = public as $$ select interval '1 hour' $$;
comment on function public._w3_separacion_sondeos() is
  'Separación mínima exigida entre los dos sondeos vacíos que habilitan la resolución negativa. Protege contra concluir "no existe" a partir de un retraso de replicación momentáneo del proveedor.';

-- ---------------------------------------------------------------------------
-- 6) RLS. Lectura para Dirección/Facturación; escritura para nadie.
-- ---------------------------------------------------------------------------
alter table public.fiscal_series          enable row level security;
alter table public.fiscal_folio_domains   enable row level security;
alter table public.fiscal_reconciliations enable row level security;

revoke all on public.fiscal_series, public.fiscal_folio_domains, public.fiscal_reconciliations
  from anon, authenticated;
grant select on public.fiscal_series, public.fiscal_reconciliations to authenticated;

create policy fiscal_series_select on public.fiscal_series
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
create policy fiscal_recon_select on public.fiscal_reconciliations
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));

-- ---------------------------------------------------------------------------
-- 7) REFUERZO DE LA GUARDA: la identidad ante el proveedor se CONGELA en cuanto
--    la intención sale de `pendiente`. Es lo que hace cierta la promesa "el
--    folio nunca se reasigna": ni el propio comando que registra el resultado
--    puede tocarlo. Se conserva verbatim el resto de la guarda de W3-A.
-- ---------------------------------------------------------------------------
create or replace function public.fiscal_documents_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    raise exception 'FISCAL_NO_SE_BORRA: un documento fiscal no se elimina; es evidencia. Se cancela o se concilia.'
      using errcode = 'check_violation';
  end if;

  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_SOLO_POR_COMANDO: la evidencia fiscal se registra con los comandos del servidor, no editando la tabla.'
      using errcode = 'check_violation';
  end if;

  if new.id <> old.id or new.order_id <> old.order_id or new.kind <> old.kind
     or new.created_at <> old.created_at then
    raise exception 'FISCAL_IDENTIDAD_INMUTABLE: no se cambia el pedido ni el tipo de un documento fiscal.'
      using errcode = 'check_violation';
  end if;

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

  if old.uuid is not null and new.uuid is distinct from old.uuid then
    raise exception 'FISCAL_UUID_INMUTABLE: el UUID del SAT ya registrado no se reescribe (%).', old.uuid
      using errcode = 'check_violation';
  end if;
  if old.uuid is not null and new.provider_env is distinct from old.provider_env then
    raise exception 'FISCAL_ENTORNO_INMUTABLE: el entorno de un comprobante ya timbrado no cambia.'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'pendiente'
     and (new.receiver is distinct from old.receiver
          or new.request_fingerprint is distinct from old.request_fingerprint) then
    raise exception 'FISCAL_SOLICITUD_CONGELADA: el contenido de la solicitud ya no se modifica en estado %.', old.status
      using errcode = 'check_violation';
  end if;

  -- W3-B · J-1/J-5: la IDENTIDAD ante el proveedor es irrepetible e irrevocable.
  -- Un reintento debe reenviarla byte-idéntica, así que nadie la reescribe.
  if old.status <> 'pendiente'
     and (new.serie is distinct from old.serie
          or new.folio is distinct from old.folio
          or new.provider_date_sent is distinct from old.provider_date_sent
          or new.issuer_rfc is distinct from old.issuer_rfc
          or (old.provider_env is not null and new.provider_env is distinct from old.provider_env)) then
    raise exception 'FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA: serie, folio, Date, RFC del emisor y entorno no se reasignan (estado %).', old.status
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
