# Auditoría de integración T1 Envíos (segundo proveedor de paquetería)

> **Escrito para:** David (dueño/decisor de la integración) y quien implemente el backend de envíos.
> **Tipo:** auditoría **READ-ONLY**. No se creó código, guías, migraciones ni escrituras de producción.
> **Fecha:** 2026-09-24 · **Estado:** pendiente de confirmación del usuario para implementar.
> **PRODUCTION WRITES: 0**

---

## ⚠️ BLOQUEADOR #1 (leer primero)

La documentación **oficial pública** de T1 Envíos **NO documenta ningún mecanismo de "API Key de servidor"**.
El **único** método de autenticación documentado es un **Bearer token de Keycloak (OAuth2 password grant)**
—usuario+contraseña del portal— **más un header `shop_id`**. Es decir: el tipo de token que pediste
explícitamente **NO usar** (`access_token/id_token/refresh_token` del portal) es el único que la doc describe.

Implicación: **si tu cuenta tiene "una API Key ya creada", ese mecanismo no está en la documentación pública**
y no podemos integrarlo con evidencia. Antes de escribir una sola línea de `t1.ts` hay que resolver esto
(ver **MISSING INFORMATION** y **RISKS**). No inventaré un esquema de API Key que la doc no respalda.

Fuente raíz: portal oficial **T1 Docs** → `https://t1docs.dev.plataformat1.com/docs/T1Envios/`
(Docusaurus/OpenAPI de Plataforma T1 / Grupo Carso). Nota: el portal tiene el **certificado TLS expirado**;
el agente lo leyó en solo-lectura, sin llamar a ningún endpoint ni usar credenciales.

---

## CURRENT SHIPPING ARCHITECTURE (confirmado en código)

**Edge Function `shipping`** — `supabase/functions/shipping/index.ts` — ya está diseñada multiproveedor:
- **Gate:** valida JWT + rol (`admin | warehouse | packing`) → si no, 401/403.
- **Acciones neutras (DHL):** `rate` · `create_shipment` · `track`.
- **Acciones legadas (agregador Envia/mock):** `quote` · `label` (intactas).
- **Seam de proveedor:** si faltan credenciales del provider pedido → **501 `not_configured`** → el cliente cae al mock.
  Este es el punto exacto donde se enchufa T1 (mismo patrón que DHL).
- **Idempotencia (create_shipment):** consulta `shipments` por `order_id` con `tracking_number` no nulo;
  si ya existe, devuelve la guía sin llamar al proveedor. Ante colisión del índice único, devuelve la existente.
- **Etiqueta:** base64 del proveedor → Storage privado `shipping-labels` → **URL firmada** (TTL 1 h). Nunca base64 permanente.

**Adapter DHL** — `supabase/functions/shipping/dhl.ts` — molde a replicar para `t1.ts`:
`buildRateRequest/parseRates`, `buildShipmentRequest/parseShipment`, `parseTracking`,
`dhlBaseUrl(test|prod)`, `dhlErrorMessage`. Auth DHL = HTTP Basic.

**Contrato neutral (cliente)** — `apps/web/src/data/shipping/provider.ts` + `model.ts`:
- Tipos neutrales: `ShipperConfig`, `Receiver`, `LogisticsPackage`, `RateQuote`, `LabelResult`.
- `LabelResult` **ya** tiene campo `provider` (`'dhl' | 't1' | 'mock'`).
- **`RateQuote` NO tiene `provider`** → hallazgo clave: con 2 proveedores, cada tarifa debe etiquetarse con su `provider`
  para enrutar la creación al adapter correcto.
- Transporte: `quoteShipment` (action `rate`), `createShipmentReal` (action `create_shipment`), `trackShipment` (action `track`),
  con detección de 501 → mock.

**Selección de proveedor en Packing** — `apps/web/src/screens/packing/Cola.tsx`:
- `cotizar()` → `quoteShipment`; el usuario elige `rateId`; `generarGuia()` → `createShipmentReal`.
- **Hoy NO hay dropdown de proveedor**: lo decide el servidor según qué credenciales existan. Para T1 como segundo
  proveedor, el servidor debe **agregar tarifas de DHL + T1** y **enrutar la creación por `rate.provider`**.

**Persistencia + idempotencia** — `supabase/migrations/20260926120000_shipping_dhl_idempotency.sql`:
- Columnas **neutrales** en `shipments`: `provider`, `service_code`, `label_path`, `package`, `ship_from`, `ship_to`, `provider_meta`.
- Índice único parcial `uq_shipments_order_tracking (order_id) WHERE tracking_number IS NOT NULL` → **máx. 1 guía por pedido**.
- Bucket privado `shipping-labels` + `company_settings.ciudad/estado/pais`.
- ⚠️ Esta migración está **versionada pero marcada "NO aplicar hasta validar en sandbox"** → **confirmar si ya se aplicó en prod**.
  Como las columnas ya son neutrales, **T1 probablemente NO requiere cambios de esquema** (ver FILES THAT WOULD CHANGE).

**Secrets esperados hoy (todos server-side, nunca cliente/VITE/repo):**
`DHL_API_USERNAME/PASSWORD/ACCOUNT_NUMBER/API_ENV` (DHL) y `SHIPPING_API_KEY/URL/RATE_PATH/LABEL_PATH` (legado).

---

## T1 API CONTRACT FOUND (con evidencia; lo NO confirmado se marca)

Fuente raíz: `https://t1docs.dev.plataformat1.com/docs/T1Envios/` (sub-URLs citadas por punto).

**Autenticación (documentada):** OAuth2 **password grant** contra Keycloak →
`POST https://keycloak.dev.plataformat1.com/auth/realms/claroshop-sapi-sa-cv/protocol/openid-connect/token`,
`Content-Type: x-www-form-urlencoded`, body `grant_type=password`, `client_id=t1envios`,
`client_secret=<preestablecido en la doc>`, `username`, `password`. Respuesta: `access_token` (JWT, `expires_in` ~1800s),
`refresh_token`, `token_type: bearer`. La página se titula **"Autenticación (Temporal)"**.
En cada request: header **`Authorization: Bearer <access_token>`**.
Fuente: `.../t-1-envios`, `.../obteneruntokendev`.
→ **Este es el token que pediste NO usar. No hay API Key de servidor documentada.**

**Store/Shop ID (338714):** aparece en TRES lugares (posiblemente identificadores distintos):
- Header **`shop_id`** (`required`) en `/quote/create`, `/guide/create`, `/guide/create-without-quote`, `/balance/consult`, `/pickup/create`.
- Body **`comercio_id`** (`required`) en quote/guide.
- Path **`:clave`** en consultar-guías y balance/history.
→ **NO CONFIRMADO** si 338714 va igual en los tres o si son ids diferentes.

**Cotización:** `POST /quote/create` — headers `Authorization` + `shop_id`.
Body: `codigo_postal_origen`, `codigo_postal_destino`, `peso` (kg int), `largo/ancho/alto` (cm int),
`dias_embarque`, `seguro`, `valor_paquete`, `tipo_paquete` (1=sobre, 2=paquete), `comercio_id`,
`paquetes?`, `generar_recoleccion?`, `productos[]?`.
Respuesta: `success`, `message`, `result[]` con `cotizacion` por paquetería y un **token por opción** (`token_quote`)
que se usa al crear la guía. **Solo 1 paquete por cotización** (FAQ).
Fuente: `.../generarcotizaciondev` / `.../generarcotizacionprod`, `.../faq`.

**Creación de guía (dos variantes):**
- Con cotización previa: `POST /guide/create` — headers `Authorization` + `shop_id`.
  Body: `contenido`, remitente `*_origen` (nombre/apellidos/email/calle/numero/colonia/telefono/estado/municipio/referencias),
  destinatario `*_destino` análogos, `generar_recoleccion`, `tiene_notificacion`, `origen_guia:"t1envios"`,
  `comercio_id`, **`token_quote`**.
  Respuesta: `success`, `message`, `location` (ej. `"test"`), `detail { paqueteria, num_orden, costo, destino,
  guia (número), file (PDF codificado), link_guia (URL), fecha_creacion }`.
- Sin cotización previa: `POST /guide/create-without-quote` — permite especificar paquetería/servicio directamente.
  **Esquema de body completo NO transcrito** (leer la página al implementar).
Fuente: `.../generarguiaapartirdecotizacionpreviadev`, `.../generarguiasincotizacionpreviadev`.

**Etiqueta:** viene EN la respuesta de crear guía (no hay endpoint aparte):
`file` = **PDF codificado** (`%PDF-1.4...`) y/o `link_guia` = URL (ej. `https://s3.plataformat1.com/guias/test/...`).
Formato **PDF**. **ZPL: NO CONFIRMADO.**

**Tracking:** `GET /webhook-maestro/query/estado-guia/:num_guia` (la doc avisa "la url final puede cambiar").
Respuesta `detail { codigo, descripcion, familia_interna/externa, guia, fecha, recibe, fecha_estimada, ... }`.
Catálogo de estatus: In Process/Collected/Transit/Delivered/Cancelled/Exception.
La página **no lista** `Authorization`/`shop_id` para tracking → **auth NO CONFIRMADA**.
Fuente: `.../consultadeestadodeguiadev`.

**Cancelación:** **NO documentada / NO existe** endpoint. `cancelada` es solo un booleano en "Consultar Guías".

**Errores:** `400/401/403/404/500` estándar; `429` con `{error,message}` (rate limit). Formato general `success:false` + `message`.
Rate limit: **100 req/min por usuario**; respuesta típica 1-5 s. Fuente: `.../common-errors`, `.../response-times-limitations`.

**Sandbox/test:** **Sí existe** ambiente de test (páginas "dev", `location:"test"`, guías en `s3.plataformat1.com/guias/test/...`,
host de auth `keycloak.dev.plataformat1.com`). **¿Consume saldo real en test? → NO CONFIRMADO** (la doc no lo dice;
hay `/balance/consult` y se requiere "agregar saldo", pero no aclara la relación test↔saldo).

**Postman/repos oficiales:** **no hay** colección oficial pública. Repo de terceros NO autoritativo:
`github.com/vimoda/t1-shipments` (referencia de implementación, no contrato). Hipótesis no oficial de host prod:
`https://api.t1envios.com` (de ese repo) → **validar con T1**.

**Endpoints extra confirmados:** `GET /balance/consult`, `GET /balance/history/:clave/...`, `POST /pickup/create`,
`GET /t1/pgs/guias-estatus/comercio/:clave/...`.

---

## MISSING INFORMATION (bloqueantes para implementar con seguridad)

1. **Base URL/host real del API (dev y prod).** La doc solo muestra rutas relativas; el host no está en el HTML.
   (Hipótesis no oficial: `api.t1envios.com` prod — sin confirmar.)
2. **Auth por API Key de servidor.** No documentada. Confirmar con soporte T1 si existe para uso server-to-server;
   si NO existe, decidir si aceptamos el password-grant de Keycloak (implica guardar credenciales del portal como secrets).
3. **Mapeo de 338714** a `shop_id` (header) vs `comercio_id` (body) vs `:clave` (path): ¿mismo valor o distintos?
4. **ZPL** (solo PDF confirmado).
5. **Cancelación** de guía (no documentada) — impacto operativo si se necesita anular.
6. **Auth del endpoint de tracking.**
7. **Si generar guía en test consume saldo real.**
8. **Esquema completo** del body de `/guide/create-without-quote`.
9. **Colección OpenAPI/Postman oficial** descargable (no encontrada).

---

## PROPOSED ADAPTER DESIGN (propuesta, NO implementada)

Reutiliza el patrón DHL sin reescribir Packing:

1. **`supabase/functions/shipping/t1.ts`** (nuevo adapter, espejo de `dhl.ts`):
   - `t1BaseUrl(env)`, `t1GetToken()` (Keycloak, con cache en memoria por `expires_in` — **si se confirma que ese es el auth**),
   - `buildQuoteRequest(shipper, receiver, pkg)` → body de `/quote/create` (mapea neutral→T1: CPs, peso, dimensiones, `comercio_id`),
   - `parseQuotes(data)` → `RateQuote[]` con `provider:'t1'`, `serviceCode` = paquetería/servicio, y **guardar `token_quote`** por opción,
   - `buildGuideRequest(...token_quote)` → `/guide/create`, `parseGuide(data)` → `{ tracking: detail.guia, labelBase64: detail.file, labelUrl: detail.link_guia }`,
   - `parseT1Tracking(data)` + mapeo del catálogo de estatus T1 → estatus neutral (`in_transit/delivered/...`),
   - `t1ErrorMessage(status, data)` sin filtrar secretos.
2. **`index.ts`** — enrutar por proveedor:
   - `action:'rate'` → devolver tarifas de **DHL ∪ T1** (los que tengan credenciales), cada `RateQuote` con `provider`.
   - `action:'create_shipment'` → mirar `rate.provider` y llamar al adapter correcto; persistir con `provider:'t1'`,
     reutilizando idempotencia, Storage de etiquetas y snapshots ya existentes.
   - `action:'track'` → si el `shipments.provider` es `t1`, usar tracking T1 (si su auth se confirma).
3. **`apps/web/src/data/shipping/provider.ts`** — añadir `provider?: 't1' | 'dhl' | ...` a `RateQuote`
   (aditivo) para que Packing muestre el carrier/proveedor por tarifa. Packing no cambia su flujo.
4. **`trackingUrl()`** — añadir el rastreo público de T1.
5. **Idempotencia:** el `token_quote` es de un solo uso; conviene un `idempotencyKey` por intento (ya existe) y confiar
   en el índice único por `order_id`.

**Nota:** el punto 1 depende por completo de resolver el BLOQUEADOR #1 (auth) y la Base URL. Sin eso, el adapter no se puede escribir con evidencia.

---

## TEST PLAN (cuando se confirme el contrato; sin consumir saldo hasta validarlo)

1. **Auth:** obtener token (dev) y validar `expires_in`/refresh; confirmar header exacto.
2. **Cotización:** `POST /quote/create` en dev con CP origen/destino reales y un paquete → validar `result[]`/`token_quote`.
3. **Guía (dev):** `POST /guide/create` con `token_quote` → validar `detail.guia`, `file` (PDF), `link_guia`, `location:"test"`.
   **Antes de esto, confirmar si test consume saldo.**
4. **Etiqueta:** subir `file` a `shipping-labels` → URL firmada (reusar pipeline DHL).
5. **Tracking:** `GET /webhook-maestro/query/estado-guia/:guia` → mapear estatus.
6. **Idempotencia:** doble `create_shipment` del mismo `order_id` → una sola guía.
7. **Seam:** sin secrets T1 → 501 → mock (no romper DHL ni la demo).
8. **Regresión DHL:** cotizar/crear/track por DHL siguen intactos; Packing muestra ambos proveedores.
9. Vitest: adapter puro (`buildQuote/parseQuotes/parseGuide/parseTracking`) con fixtures de la doc.

---

## RISKS

- **Auth incompatible (crítico):** la doc solo describe password-grant de Keycloak (token de portal) + `shop_id`.
  Guardar usuario/contraseña del portal como secrets es un modelo distinto (y más frágil) que la API Key de DHL.
  Si existe una API Key server-side, **falta su documentación**.
- **Host base no confirmado:** implementar contra un host no oficial es riesgo de romper en prod.
- **Saldo real en test:** sin confirmar → riesgo de gastar saldo al probar guías.
- **Sin cancelación:** guías erróneas no se pueden anular por API (proceso manual/portal).
- **Tracking sin auth clara y "url puede cambiar":** endpoint inestable.
- **Migración de idempotencia posiblemente NO aplicada en prod:** si el path DHL/T1 escribe columnas inexistentes, fallará;
  verificar estado de `20260926120000_shipping_dhl_idempotency.sql` en el proyecto.
- **`shop_id` vs `comercio_id` vs `:clave`:** un id equivocado en el lugar equivocado = 400/403.

---

## FILES THAT WOULD CHANGE (al implementar; NADA cambiado en esta auditoría)

- `supabase/functions/shipping/t1.ts` — **nuevo** adapter.
- `supabase/functions/shipping/index.ts` — enrutado por `rate.provider` (rate/create_shipment/track).
- `apps/web/src/data/shipping/provider.ts` — `provider?` en `RateQuote` (aditivo) + `trackingUrl()` T1.
- `supabase/functions/shipping/README.md` — documentar secrets/activación T1.
- (Tests) fixtures/adapter T1 en vitest.
- **DB migration:** **probablemente NO** (columnas neutrales ya existen) — **pendiente confirmar** que la migración de idempotencia esté aplicada en prod.

## SECRETS REQUIRED (server-side; nunca cliente/VITE/repo/logs)

- Dependen del BLOQUEADOR #1. Según la doc actual serían credenciales de Keycloak:
  `T1_USERNAME`, `T1_PASSWORD`, `T1_CLIENT_ID` (`t1envios`), `T1_CLIENT_SECRET`, `T1_SHOP_ID` (338714),
  `T1_COMERCIO_ID`, `T1_API_ENV` (dev|prod), y `T1_API_BASE_URL` (hasta confirmar host).
- **Si T1 confirma una API Key de servidor:** en su lugar `T1_API_KEY` (+ header exacto) — preferible. **A confirmar.**

---

## PRODUCTION WRITES: 0

No se crearon guías, no se consumió saldo, no se llamaron endpoints de T1, no se modificó código ni se desplegó.
Investigación de doc en solo-lectura. **No implementar hasta confirmación del usuario.**
