-- ============================================================================
-- W3-A · F2 — CONSTRAINTS E IDEMPOTENCIA ESTRUCTURAL.
--
-- Aquí vive lo que hace IMPOSIBLE el P0 actual, sin depender de que ningún
-- programa se porte bien:
--
--   I-1 Un documento fiscal VIVO por pedido (pendiente/en_proceso/timbrado/
--       incierto). Solo `fallido` y `cancelado` liberan la ranura.
--   I-2 Un UUID del SAT existe UNA vez en todo el sistema.
--   I-3 `timbrado` ⇔ UUID presente y con forma válida. No hay forma de escribir
--       status='timbrado' con uuid nulo: ni por error interno, ni a mano.
--   I-4 Un comprobante con UUID sabe siempre en qué ENTORNO se timbró.
--   I-5 `en_proceso` implica un reclamo real; `incierto` implica que hubo reclamo.
--   I-6 El receptor de un documento fiscal está COMPLETO (6 datos canónicos).
--   I-7 Nuestro folio, cuando lo asignamos, es único por entorno: es la llave con
--       la que se busca un timbre huérfano en el PAC.
-- ============================================================================

-- ------------------------------------------------------------------ vocabulario
alter table public.fiscal_documents
  add constraint ck_fiscal_status check (status in
    ('pendiente','en_proceso','timbrado','fallido','incierto','cancelado')),
  add constraint ck_fiscal_kind check (kind in ('ingreso','egreso','pago')),
  add constraint ck_fiscal_provider_env check (provider_env is null or provider_env in ('sandbox','produccion')),
  add constraint ck_fiscal_intentos check (attempts >= 0),
  add constraint ck_fiscal_importes check (
    coalesce(subtotal, 0) >= 0 and coalesce(iva, 0) >= 0 and coalesce(total, 0) >= 0);

-- ------------------------------------------------- I-3 · la prueba del timbrado
-- Un UUID existe exactamente cuando el comprobante existe ante el SAT: timbrado
-- o cancelado (cancelar NO borra el UUID). En cualquier otro estado no hay UUID.
alter table public.fiscal_documents
  add constraint ck_fiscal_uuid_estado check ((uuid is not null) = (status in ('timbrado','cancelado'))),
  add constraint ck_fiscal_uuid_formato check (
    uuid is null or (
      uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and uuid !~ '^0{8}-0{4}-0{4}-0{4}-0{12}$'));
comment on constraint ck_fiscal_uuid_estado on public.fiscal_documents is
  'W3-A · I-3: no existe status=timbrado sin UUID, ni UUID en un estado que no sea timbrado/cancelado. Cierra el P0 por estructura.';

-- --------------------------------------------- I-4 · entorno de todo comprobante
alter table public.fiscal_documents
  add constraint ck_fiscal_env_presente check (uuid is null or provider_env is not null);

-- ------------------------------------------------------- I-5 · reclamo coherente
alter table public.fiscal_documents
  add constraint ck_fiscal_claim check (
    status <> 'en_proceso' or (claim_id is not null and claimed_at is not null)),
  add constraint ck_fiscal_incierto check (
    status <> 'incierto' or claimed_at is not null);
comment on constraint ck_fiscal_incierto on public.fiscal_documents is
  'W3-A: `incierto` describe una intención que YA fue reclamada y cuyo efecto en el PAC no se conoce. No se llega a incierto sin haber intentado.';

-- --------------------------------------------------- I-6 · receptor completo
alter table public.fiscal_documents
  add constraint ck_fiscal_receptor_completo check (public._fiscal_error(receiver) is null);
comment on constraint ck_fiscal_receptor_completo on public.fiscal_documents is
  'W3-A · I-6: no existe una intención fiscal con receptor incompleto. Los 6 datos canónicos se validan al crearla; nunca se completan con defaults.';

-- ------------------------------------------ I-1 · un documento VIVO por pedido
-- ESTA es la idempotencia de negocio: mientras haya intención viva, no puede
-- nacer otra para el mismo pedido. Un `incierto` bloquea una nueva emisión; un
-- `fallido` (sin efecto demostrado) y un `cancelado` liberan la ranura.
create unique index uq_fiscal_doc_vivo on public.fiscal_documents(order_id, kind)
  where status in ('pendiente','en_proceso','timbrado','incierto');
comment on index public.uq_fiscal_doc_vivo is
  'W3-A · I-1: máximo UNA intención fiscal viva por pedido. Hace imposible el doble timbrado aun con dos workers concurrentes.';

-- ----------------------------------------------------- I-2 · un UUID, una vez
create unique index uq_fiscal_doc_uuid on public.fiscal_documents(uuid) where uuid is not null;
comment on index public.uq_fiscal_doc_uuid is
  'W3-A · I-2: un UUID del SAT no puede aparecer dos veces. Protege la adopción de timbres huérfanos de crear duplicados locales.';

-- ------------------------------------------------- I-7 · nuestro folio, único
-- `coalesce` sobre entorno y serie a propósito: en un índice único los NULL se consideran
-- distintos entre sí, y eso permitiría repetir el mismo folio mientras el entorno aún no
-- está asignado — precisamente la ventana en la que se reserva el folio.
create unique index uq_fiscal_doc_serie_folio
  on public.fiscal_documents(provider, coalesce(provider_env, ''), coalesce(serie, ''), folio)
  where folio is not null;
comment on index public.uq_fiscal_doc_serie_folio is
  'W3-A · I-7: serie+folio asignados por Renovacell son únicos por proveedor y entorno. Es la llave de búsqueda de un timbre huérfano (W3-B). La SERIE en sí queda abierta (D-W3-7): aquí no se inventa ninguna.';

-- ----------------------------------------------------- bitácora: vocabulario
alter table public.fiscal_document_events
  add constraint ck_fiscal_event_from check (from_status is null or from_status in
    ('pendiente','en_proceso','timbrado','fallido','incierto','cancelado')),
  add constraint ck_fiscal_event_to check (to_status in
    ('pendiente','en_proceso','timbrado','fallido','incierto','cancelado')),
  add constraint ck_fiscal_event_tipo check (event in
    ('solicitud','solicitud_actualizada','descarte','claim','timbre','fallo',
     'incierto','conciliacion','cancelacion'));
