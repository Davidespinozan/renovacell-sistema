# Runbook de GO-LIVE coordinado — Renovacell

Estado al preparar (2026-09-15). Proyecto Supabase `amurlvlvfohwucvxfdot`.
**No se ha desplegado ni commiteado nada.** Este documento es el plan.
> **SUPERSEDED (2026-09-24):** la línea anterior refleja el estado al *preparar* el plan (2026-09-15). Desde entonces se desplegó y commiteó lo descrito abajo. Ver el bloque **CIERRE ETAPA 5**.

---

## ✅ CIERRE ETAPA 5 — CERRADA DESDE DESARROLLO (2026-09-24)
**STAGE 5: PASS.** Todo verificado en producción (read-only). Los pendientes son **CLIENT-BLOCKED**, **BUSINESS-CONFIRMATION** o **STAGE-6** — no son fallos de Etapa 5.

**CUSTOMERS**
- 2,568 customers · migración comercial **separada de Auth** (`profiles`=6 staff) · CustomerDirectory operativo.

**CATALOG**
- 192 products · 181 sellable · 5 visual parents · 117 variantes de familia sellable · `catalog_public` 68 · child leaks 0.

**GENERAL PRICING**
- 179 precios autoritativos `COMMERCIAL_SEP_2026`.

**VOLUME PRICING**
- 173 reglas activas: **12 × 5%@5 · 34 × 10%@5 · 127 × 10%@10** · universales · threshold **por SKU** · server-side authority (`precio_de(product,list,qty)`).

**MAYOREO**
- `price_list` conservada · 0 overrides · 0 clientes asignados · reservada para precios contractuales futuros · **58 overrides legacy eliminados**.

**COSTS**
- 174 `product_costs`.

**INVENTORY — CLIENT-BLOCKED**
- lots 0 · inventory_movements 0 · **stock-gate activo** (impide sobreventa) · pendiente del **export de existencias de Odoo** (Renovacell).

**INTEGRACIONES (estado auditado, sin declarar productivo lo no confirmado)**
- **DHL:** Sandbox E2E **PASS**; **producción PENDIENTE**.
- **Facturama (CFDI):** pendiente/bloqueado por credenciales + CSD.
- **Stripe:** pendiente/bloqueado por credenciales.
- **Meta/WhatsApp:** pendiente/bloqueado por credenciales + App Review.
- **T1:** Stage 6.

**BUSINESS-CONFIRMATION**
- 8 REVIEW (REL-005, REL-009, NEW-010, NEW-014, XEL-001..004) · NABOTA 150 UI pendiente de alta · Rejuran PN pendiente de alta · vigencia de la lista comercial · futura precedencia tier-vs-volume.

**STAGE 6**
- T1 · DHL producción · UI "desde N piezas" · activación de integraciones al recibir credenciales · **rotación de credenciales demo antes de go-live**.

**Estado para cliente:** *"La información proporcionada para migración está procesada y validada. El inventario por lote queda pendiente de importación al recibir el export de existencias de Odoo."*

> Las notas más abajo son el **log cronológico** (evidencia por fase). Donde una nota intermedia diga "pendiente/no iniciada", está **SUPERSEDED** por este bloque de cierre.

---

## Cambios pendientes de desplegar (sin commit aún)
**Frontend** (Netlify, al hacer push a `main`):
- `data/store/ordersStore.ts` — pedido del doctor vía RPC `crear_pedido` (precio server-side).
- `data/mock/accounts.ts` — cuentas demo fuera del bundle de prod.
- `data/database.types.ts` — tipos de `crear_pedido`/`precio_de`.
- `screens/admin/Facturacion.tsx`, `screens/Bandeja.tsx`, `data/ops/cfdi.ts` — CFDI `timbrada`/`emitida` (fuente única).
- (+ tests nuevos; no afectan runtime.)

**Migración Supabase** (una sola pendiente, confirmado con `supabase migration list`):
- `20260915120000_p0_precio_servidor.sql` — `precio_de`, `crear_pedido`, `vender_pos` recalculado, **RLS lockdown del doctor**, `profiles_guard` + `price_list_id`.
- Todas las anteriores (000…20260810120000, incl. `company_settings`) ya están **remotas/aplicadas**.

**Edge Functions:**
- `cfdi` (+`rules.ts`) — modificada (ExpeditionPlace del emisor, idempotencia). **Redeploy.**
- `register-doctor` — marcada pendiente en `deploy.md`; estado remoto **no verificado** (API de functions en mantenimiento al preparar). Confirmar/desplegar.

## Dependencia crítica (evitar downtime del Portal del Doctor)
La migración endurece la RLS: el doctor **ya no** inserta `orders` directo, solo vía `crear_pedido`.
- Si la migración va ANTES que el frontend nuevo → el frontend VIEJO (insert directo) rompe la creación de pedidos del doctor.
- Si el frontend nuevo va ANTES que la migración → llama a `crear_pedido` que aún no existe.
→ Deben ir **casi simultáneos**. Ventana afectada = SOLO creación de pedido del doctor (catálogo, ver pedidos, POS y admin no se afectan; `vender_pos` es compatible hacia atrás).

## A. ORDEN DE DEPLOY (near-zero downtime)
1. **Construir el frontend sin publicar**: push a un deploy de Netlify (preview/locked) para que compile el bundle nuevo **sin** hacer swap a producción todavía.
2. **Aplicar la migración**: `supabase db push` (aplica `20260915120000`; su self-test aborta si algo falla). Segundos.
3. **Publicar el frontend ya construido** (swap instantáneo del deploy del paso 1). Ahora el frontend usa `crear_pedido`, que ya existe. Ventana ≈ segundos.
4. **Desplegar Edge Functions**: `supabase functions deploy cfdi` (lleva `rules.ts`). No rompe (Facturama sigue en 501 hasta credenciales). Verificar/desplegar `register-doctor`.
5. **Post-deploy (mismo día, antes de operar):**
   - Capturar en **Configuración de la empresa** el emisor CFDI: razón social, RFC, régimen SAT, **CP** (si falta, timbrar responde 422 por diseño).
   - **Cambiar contraseñas** de todas las cuentas demo (sección E) y verificar que la contraseña demo compartida ya no autentica.
   - Smoke: crear un pedido de doctor y confirmar que el `total` guardado es el del servidor.
> Alternativa sin el truco de "build sin publicar": aceptar ~2–4 min (build de Netlify) en que la creación de pedido del doctor falla → hacerlo en horario de bajo tráfico. (Cero-downtime real requeriría partir la migración en no-breaking + breaking; queda como opción si se necesita.)

## B. CHECKLIST CLIENTE (lo aporta Renovacell)
Secretos = Supabase → Edge Functions → Secrets (nunca en el repo). NUNCA compartir por chat inseguro.
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — cobros con tarjeta + confirmación de pago.
- [ ] `FACTURAMA_USER`, `FACTURAMA_PASS` + **CSD** cargado en Facturama — timbrado CFDI 4.0.
- [ ] `SHIPPING_API_KEY` (agregador Estafeta/DHL) — generar guías reales.
- [ ] `ANTHROPIC_API_KEY` — asistente IA real (sin él, motor local mock).
- [ ] `CEDULA_API_URL`, `CEDULA_API_KEY` — verificación de cédula (SEP/RENAPO).
- [ ] `IDENTITY_API_URL`, `IDENTITY_API_KEY` (Nubarium) — KYC biométrico (liveness+INE).
- [ ] `META_VERIFY_TOKEN`, `META_APP_SECRET` — recepción multicanal (WhatsApp/IG/FB).
- [ ] `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` (+ `META_PAGE_TOKEN` para IG/Messenger) — envío saliente.
- [ ] SMTP en Supabase Auth (opcional) — correos de reset/invitación con dominio propio.
- [ ] **company_settings**: razón social, RFC, régimen fiscal SAT, **CP de expedición**, dirección, tel, correo, logo — emisor del CFDI y encabezados.
- [ ] **Datos/costos**: costos reales por producto (habilita margen en Finanzas), precios reales de la línea Professional (hoy placeholder), foto del producto "Íntimo", textos legales finales.
- [ ] **Exportaciones de Odoo (CSV)**: clientes/doctores, inventario por lote con caducidad, costos (ver D).
- [ ] **App Review de Meta** (si recibirán de cualquier usuario, no solo cuentas propias).

## C. INTEGRACIONES
| Integración | Estado | Nota |
|---|---|---|
| Núcleo (pedidos/inventario/POS/finanzas/precios) | **READY** | Backend real; probable YA probado contra prod. No es "integración". |
| Storage (evidencia/proofs, media) | **READY** | Sin credencial externa. Probable hoy. |
| Reset de contraseña (Supabase Auth) | **READY** | Email nativo de Supabase; SMTP propio opcional. |
| Stripe (checkout + webhook) | **BLOCKED** | Falta `STRIPE_*`. |
| Facturama / CFDI | **BLOCKED** | Falta `FACTURAMA_*` + CSD (+ capturar company_settings CP). |
| Paquetería | **BLOCKED** | Falta `SHIPPING_API_KEY`. |
| Agente IA (LLM real) | **BLOCKED** | Falta `ANTHROPIC_API_KEY` (mock funciona sin él). |
| Meta/WhatsApp/IG/FB | **BLOCKED** | Falta `META_*`/`WHATSAPP_*` (+ App Review). |
| KYC / cédula (Nubarium/SEP) | **BLOCKED** | Falta `CEDULA_API_*`, `IDENTITY_API_*`. |

## D. MIGRACIÓN ODOO — **PARTIAL**
- **Herramienta:** importador CSV idempotente (Admin → Importar/Migración; `migrationStore.ts`). 4 cargas: catálogo, clientes/doctores, inventario por lote (con caducidad), costos. Reintentable sin duplicar; descarga "no importados" para corregir.
- **Ya cargado:** catálogo real (64 productos) en prod.
- **Falta para el corte final:** costos por producto, clientes/doctores, e inventario inicial por lote con caducidad.
- **Del cliente:** exportación CSV de Odoo de **clientes/doctores**, **inventario por lote (código de lote + caducidad + cantidad)** y **costos**. Con eso se hace el corte (importar en ese orden: catálogo→costos→clientes→inventario).

## E. CUENTAS QUE REQUIEREN CAMBIO DE PASSWORD (antes del go-live)
(Existen en Supabase Auth con la contraseña demo compartida; solo emails, sin passwords.)
- direccion@renovacell.mx
- almacen@renovacell.mx
- ventas1@renovacell.mx
- ventas2@renovacell.mx
- chofer@renovacell.mx
- chofer2@renovacell.mx
- laura.mendez@renova.mx  (doctora demo)
- mario.ruiz@dermamr.mx   (doctor demo en revisión)
→ Cambiar/resetear todas; verificar que la contraseña demo ya no autentica; revocar sesiones activas. Ver `docs/go-live-security-checklist.md`.

## F. BLOQUEADORES RESTANTES PARA GO-LIVE
1. **Deploy coordinado** del lote pendiente (frontend + migración `20260915120000` + función `cfdi`) — sección A. (Requiere commit/push, que aún no se hace.)
2. **Contraseñas demo** en Auth (sección E) — riesgo de seguridad #1.
3. **Credenciales de integraciones** (sección B) — sin ellas, cobro/CFDI/guías/KYC/multicanal no operan.
4. **company_settings** (emisor CFDI) sin capturar → el timbrado responde 422.
5. **Corte de datos de Odoo** (sección D): costos, clientes, inventario inicial.
6. **Confirmar `register-doctor` desplegado** (no verificable al preparar por mantenimiento de la API de functions).

## G. HITO DE INFRAESTRUCTURA — CUTOVER DE NETLIFY (2026-09-23)
> Evidencia para el **Reporte 5** (cutover/migración de infraestructura). Registra el estado a la fecha; los ítems marcados **PENDIENTE** aún no se ejecutan.

**Fecha:** 23 de septiembre de 2026
**Hito:** Migración del deployment frontend a infraestructura Netlify **propiedad/control de Renovacell**.

| Campo | Valor |
|---|---|
| **Nuevo Netlify** | https://sistemaoperativorenovacell.netlify.app |
| **Estado** | Published / Production |
| **Branch** | `main` |
| **Commit desplegado** | `c9ce6a2` (según Netlify) |
| **Origen** | GitHub del cliente / Renovacell |
| **Backend** | Mismo proyecto Supabase productivo — **no se duplicó base de datos** |
| **Arquitectura** | Una base / un backend / múltiples puertas |

**Variables de entorno migradas** (valores **no** documentados):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Nota sobre el deployment anterior:** el Netlify del desarrollador (`sistema-renovacell.netlify.app`) **permanece temporalmente activo como respaldo** durante el cutover y **NO** debe considerarse infraestructura final del cliente. Su retiro queda como pendiente (abajo).

**QA del nuevo deployment — PASS (2026-09-23):** verificado por HTTP (sin login ni escritura de datos).
- `GET /` → 200, landing Renovacell (219 KB, `canonical` → `renovacell.mx`).
- `GET /sistema` → 200, SPA (título "Sistema operativo"); `/sistema/*` profundo → 200 sirve la app (no landing).
- Assets: `index-Ch7dKwsp.js` → 200 (810 058 B, `application/javascript`); `index-BtEJ8FQm.css` → 200.
- **Mismo build/commit que prod**: bundle **byte-idéntico** al del Netlify anterior (`md5 67a0e329…`, 810 058 B) → commit `c9ce6a2`.
- **ENV efectivas**: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` presentes en el bundle y apuntando al **mismo** proyecto Supabase productivo (`amurlvlvfohwucvxfdot`); al ser byte-idéntico al deployment en operación, las credenciales migradas son las válidas (valores no documentados). Host Supabase responde.
- **Rewrites `netlify.toml`** aplicadas (`/`→landing, `/sistema/*`→app, fallback root→landing).
- **Security headers** presentes (CSP `frame-ancestors 'self'`, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- **Sin referencias** al Netlify anterior en páginas ni bundle; sin errores críticos de carga (todos los recursos 200).

**Reglas de dominio preparadas en código — `netlify.toml` (2026-09-23):** listas para cuando los dominios se asignen a la site (hoy inertes; no afectan `sistemaoperativorenovacell.netlify.app`). Validado local: `tsc` 0 · 585 tests · build OK · TOML parseado (12 redirects, sin loops).
- `renovacell.mx` → landing / canónico (reglas genéricas).
- `www.renovacell.mx` → **301** `https://renovacell.mx/:splat`.
- `sistema.renovacell.mx` → `/` **301** `/sistema`; `/sistema/*` sirve la SPA.
- `portal.renovacell.mx` → `/` **301** `/sistema`; misma SPA (el hostname **no** autoriza; RLS/roles intactos).
- `renovacell.com.mx` + `www` → **301** `https://renovacell.mx/:splat`.
- `goldenplacenta.com` + `www` (**dominio legado**) → **301** `https://renovacell.mx/:splat`.
- `/sistema` se mantiene como ruta interna; assets/manifest/imágenes/rutas profundas intactos.

> **No** confirmados aún (requieren acción fuera del repo, siguen pendientes): DNS en Hostinger, alta de dominios + SSL en Netlify, y Supabase Auth (Site URL / Redirect URLs). Estas reglas no surten efecto hasta que el DNS/dominios estén configurados.

**Pendientes registrados (aún no ejecutados):**
- [x] ~~QA del nuevo deployment~~ → **PASS (2026-09-23)**, evidencia arriba.
- [x] ~~Reglas de dominio/redirects en código~~ → **preparadas en `netlify.toml` (2026-09-23)**; inertes hasta DNS/SSL.
- [ ] Configuración de dominios oficiales (alta en Netlify + DNS):
  - [ ] renovacell.mx
  - [ ] www.renovacell.mx
  - [ ] sistema.renovacell.mx
  - [ ] portal.renovacell.mx
  - [ ] renovacell.com.mx
  - [ ] www.renovacell.com.mx
  - [ ] goldenplacenta.com
  - [ ] www.goldenplacenta.com
- [ ] Redirects 301 canónicos **activos** (verificar en vivo post-DNS; ya preparados en código)
- [ ] SSL de todos los hostnames
- [ ] Actualización de Supabase Auth **Site URL** / **Redirect URLs**
- [ ] Validación final post-DNS
- [ ] Retiro posterior del deployment temporal del desarrollador

## H. HITO — DHL EXPRESS (MyDHL API) FASE 1: INFRAESTRUCTURA LIVE (2026-09-23)
> Evidencia para el **Reporte 5**. Integración logística multiproveedor (DHL primero, T1 después) desplegada en producción. **DHL NO está cerrado**: falta el E2E Sandbox.

**Commit desplegado:** `819f99e` (author/committer = `albertogutierrez-cell`, contributor autorizado del Netlify de Renovacell). Bundle en producción: `index-CQsSNEqA.js`.

**Verificado en producción (PASS):**
- [x] **Commit `819f99e` desplegado** — Published en `sistemaoperativorenovacell`; bundle `index-CQsSNEqA.js` LIVE en los 3 hosts.
- [x] **Frontend nuevo LIVE** — verificado por hash + marcadores de código nuevo.
- [x] **Packing logístico LIVE** — UI captura peso / largo / ancho / alto / piezas de la caja final + validación de datos faltantes (bloqueo con detalle exacto; sin defaults silenciosos).
- [x] **`company_settings` compatible con configuración de remitente** — columnas `ciudad/estado/pais` aplicadas; la consulta de la app responde 200 (sin `SelectQueryError`).
- [x] **Routing estable** — `renovacell.mx` → landing 200; `sistema.renovacell.mx/` → 301 `/sistema`; `portal.renovacell.mx/` → 301 `/sistema`.
- [x] **`sistema.*` sin 500/503** — verificación repetida: `/` 12/12 × 301, `/sistema` 12/12 × 200 (el 5xx intermitente previo era un deploy a medio publicar; resuelto).
- [x] **Edge Function `shipping` v7 ACTIVE**.
- [x] **`shipping-labels` privado** (`public: false`) — etiquetas por URL firmada, nunca base64 permanente.
- [x] **Migración `20260926120000` aplicada** — idempotencia (índice único parcial por `order_id` con tracking), snapshots neutrales (`package/ship_from/ship_to/provider_meta`), `provider/service_code/pickup_confirmation/label_path`.

**DHL Sandbox — infraestructura READY, E2E PENDIENTE:**
- [x] Infraestructura lista (código + migración + edge + storage) con `DHL_API_ENV=test`.
- [ ] Secrets DHL de TEST cargados por David (`DHL_API_USERNAME`, `DHL_API_PASSWORD`, `DHL_ACCOUNT_NUMBER`, `DHL_API_ENV=test`).
- [ ] Remitente real capturado en Configuración de empresa.
- [ ] **E2E Sandbox:** cotización → guía → etiqueta (Storage + URL firmada) → tracking → **idempotencia**.
- [ ] Activación de producción (solo tras validar sandbox; `DHL_API_ENV=production`).

> **DHL NO se considera integración cerrada** hasta completar el E2E Sandbox. T1 aún no se implementa (el modelo ya es neutral para agregarlo sin reescribir Packing).

### DHL Sandbox E2E — **PASS (2026-09-23)**
E2E real contra MyDHL API TEST (`DHL_API_ENV=test`), con fixture QA temporal (usuario staff + orden `QA-DHL-E2E`), **ya eliminado**. Sin producción DHL, sin venta/inventario real.
- **PRECHECK:** función `shipping` ACTIVE; `shipping_*` completo; `shipping-labels` privado; migraciones aplicadas; secrets DHL presentes (confirmado porque `rate` respondió, no 501).
- **QUOTE:** HTTP **200** — servicios reales DHL: EXPRESS DOMESTIC (`N`, $444 MXN), 12:00 (`1`, $531), 10:30 (`O`, $568), 9:00 (`I`, $900), ECONOMY SELECT (`G`, $478).
- **SHIPMENT:** HTTP **200** — tracking **7360109201**, service_code `N`.
- **LABEL:** PDF real (15 372 B) en bucket **privado** `shipping-labels`; signed URL → 200 `application/pdf`; acceso público → **400** (privado).
- **PERSISTENCIA:** `provider=dhl`, `tracking_number`, `service_code`, `package`, `ship_from`, `ship_to`, `provider_meta`, `label_path` ✓.
- **IDEMPOTENCIA:** 2ª creación → `idempotent:true`, **mismo tracking**; `SHIPMENTS FOR ORDER = 1` (índice único parcial).
- **TRACKING:** endpoint alcanzado; Sandbox devolvió "No data found" (guía recién creada, sin eventos) — round-trip correcto.
- **ERROR-SAFETY:** un 422 real de DHL **no** persistió shipment ni marcó la orden enviada (siguió `packed`); errores sanitizados (sin secrets).
- **Corrección mínima aplicada** (por respuesta real del Sandbox): en el shipment request, el formato de etiqueta va en `outputImageProperties.encodingFormat='pdf'`, no en `imageOptions[].imageFormat` (DHL 422 "extraneous key [imageFormat]"). Función redeployada.

> **DHL PRODUCCIÓN: PENDIENTE** — el requisito contractual de una guía real de producción sigue abierto (no se activó `production`).

**Conciliación de precios vs lista comercial "PRECIOS 2026 · SEPTIEMBRE" (2026-09-24) — APLICADO:** conciliación completa (Odoo + sistema + lista comercial + Mayoreo). Migrados **179 precios autoritativos** (`price_source=COMMERCIAL_SEP_2026`): 62 standalone directos + 117 variantes de las 5 familias (Hidrolizados 46×$1,000 · Implantes 40×$2,400 · Ultrafiltrados 19×$15,000 · ELITE 6×$25,000 · Agujas FMC 6×$120). Migración `20260930120000_prices_commercial_sep2026.sql` (por `product_id`, idempotente, con guardas; **aplicada**). Verificado: 179/179 precios exactos; 5 visual parents sin precio vendible; **sin cambios** en Mayoreo (58 filas, sum 160813), costos (174), sellable (60), inventario/clientes. Pendientes: **8 productos en REVIEW** (Xelaju N Sperma, Revage R PDLA, NABOTA genérico, STEMLASH, XELAJU DEEP/FINE/HYLO/VOLUME), **2 productos de la lista sin alta** (NABOTA 150 UI, Rejuran PN), **Mayoreo** pendiente de reconciliación posterior, **promociones** capturadas (5%/10% a 5/10 pzs) no implementadas, **inventario** pendiente del export del cliente. `sellable` sin cambios (121 candidatos a habilitar en fase aparte). — **SUPERSEDED (2026-09-24):** Mayoreo reconciliada y limpiada (Fase 3), promos implementadas como 173 reglas de volumen (Fase 2), sellable 121 habilitados; ver **CIERRE ETAPA 5**. Inventario sigue CLIENT-BLOCKED.

**Precios por VOLUMEN — Fase 3: limpieza Mayoreo legacy (2026-09-24) — APLICADO:** migración `20261004120000_cleanup_mayoreo_legacy.sql` (idempotente, guardas): eliminadas las **58** filas legacy de `product_prices` de la lista Mayoreo (codificaban promos sin threshold). La **lista `price_lists.Mayoreo` se conserva** (para precios contractuales por cliente futuros). Verificado: Mayoreo overrides **0**, lista intacta, 0 asignaciones; `product_volume_prices` 173 intactas; products 192, sellable 181, General 179, costos 174, customers 2568, inventario 0. Regresión de precios sin cambios (Botox 4370@5, Xeomeen 3150@5, Hidro 900@10, multi 1000+1000, WEGOVY General). `precio_de(prod, Mayoreo, 1)=General` y `(…, 5)=volumen` → la lista Mayoreo queda funcional y vacía, lista para uso real. Idempotente (re-push "up to date"). **Las promociones Sep-2026 se representan EXCLUSIVAMENTE por las 173 reglas universales `product_volume_prices` (thresholds por SKU, server-side authority, vigencia hasta sustitución).**

**Precios por VOLUMEN — Fase 2: 173 reglas comerciales Sep-2026 (2026-09-24) — APLICADO:** migración `20261003120000_volume_rules_sep2026.sql` (por `product_id`, idempotente `on conflict do update`, guardas G1–G8). `product_volume_prices` = **173** (5%@5=12 · 10%@5=34 · 10%@10=127), 173 productos distintos. Precio = General autoritativo × (1−disc). Verificado E2E vía `precio_de(product,null,qty)`: Botox 4600/4600/**4370**/4370 · Xeomeen 3500/3500/**3150** · Hidrolizado 1000(q9)/**900**(q10) · multi-SKU 1000+1000 (sin combinar) · WEGOVY 2980/2980 (sin regla). Los 3 flujos (`crear_pedido`/`vender_pos`/pedido-cliente) consumen ese `precio_de(...,qty)` (servidor autoridad; precio de frontend ignorado). Sin cambios: products 192, sellable 181, General 179, **Mayoreo 58 dormidas (0 asignaciones)**, costos 174, inventario 0. Idempotente (segundo push = "up to date", 173 estable). ~~**Fase 3 (limpieza de las 58 Mayoreo legacy) NO iniciada.**~~ — **SUPERSEDED (2026-09-24):** Fase 3 aplicada (58 overrides eliminados; ver CIERRE ETAPA 5). Vigencia: hasta sustitución (sin `expires_at`).

**Motor de precios por VOLUMEN — Fase 1 (2026-09-24) — APLICADO:** promo universal por SKU (desde N unidades), independiente de price_list. Migración `20261002120000_volume_pricing_engine.sql`: tabla `product_volume_prices` (universal, `min_quantity>=2`, `unique(product_id,min_quantity)`, RLS auth-read/admin-write) + `precio_de(product,list,qty)` (base=override lista ∥ General; volumen=mejor `min_quantity≤qty`; resultado `LEAST(base,volumen)` **interim** tier-vs-volume) + wrapper `precio_de(product,list)`=qty1 + `crear_pedido`/`vender_pos` pasan qty. **Backward-compatible**: tabla vacía + qty1 ⇒ mismo precio (validado: Botox qty1/5/10 = 4600). Verificado: `product_volume_prices`=0, products 192, sellable 181, Mayoreo 58 intactas (0 asignaciones), costos 174, inventario 0. ~~**Fase 2 (insertar 173 reglas + limpiar 58 Mayoreo) NO iniciada.**~~ — **SUPERSEDED (2026-09-24):** Fase 2 y Fase 3 aplicadas (173 reglas activas; 58 Mayoreo eliminadas); ver CIERRE ETAPA 5. Pendientes de negocio: vigencia (hasta sustitución; sin `expires_at`) y precedencia tier-vs-volume (inerte: 0 Mayoreo).

**Habilitación de venta (sellable) de los 121 con precio autoritativo (2026-09-24) — APLICADO:** migración `20261001120000_enable_sellable_121.sql` (por `product_id`, idempotente, 6 guardas). `sellable` **60 → 181** (117 variantes de familia + 4 standalone: DYSPORT, EMLA, RADIESSE CLÁSICO, RADIESSE-LIDO). Verificado: 121/121 sellable=true; 5 visual parents siguen false; 8 REVIEW sin cambios; precios 179/179, Mayoreo 58, costos 174, inventario 0 **sin cambios**. La landing pasó 64→68 (los 4 standalone; variantes hijas NO se filtran). **Stock-gate activo**: con inventario 0 los productos salen "Agotado"/no agregables en POS/Nuevo Pedido/Portal (sin sobreventa). `sellable` de los 8 REVIEW y NABOTA 150/Rejuran PN pendientes; inventario pendiente del export del cliente.

**Catálogo público (landing) respeta familias/variantes (2026-09-24) — APLICADO:** la vista `catalog_public` se redefinió para devolver solo TOP-LEVEL (familias con hijos + standalone vendibles), excluyendo variantes hijas y parents huérfanos. Migración `20260929120000_catalog_public_families.sql` **aplicada a producción**. Verificado (anón): `catalog_public` = **64** (5 familias + 59 standalone), **0 variantes filtrándose**; Hidrolizados/Implantes/Ultrafiltrados/ELITE/Agujas FMC = 1 tarjeta c/u; la landing y el asistente público (`__rncCatalog`) reciben el catálogo agrupado en runtime (sin deploy de Netlify). Sin cambios en products/precios/costos/inventario (products sigue 192).

**Mejora post-E2E (2026-09-24):** tracking normalizado — un `404 / "No data found"` de una guía válida recién creada se devuelve como éxito de dominio (`status: sin_eventos`, `events: []`, "Aún no hay eventos de seguimiento"), no como 502. Auth (401/403), request inválido (400) y 5xx inesperados siguen siendo error real. Con tests. No cambia el estado: **DHL SANDBOX E2E: PASS · DHL PRODUCTION: PENDING**.
