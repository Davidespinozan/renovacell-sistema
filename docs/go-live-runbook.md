# Runbook de GO-LIVE coordinado — Renovacell

Estado al preparar (2026-09-15). Proyecto Supabase `amurlvlvfohwucvxfdot`.
**No se ha desplegado ni commiteado nada.** Este documento es el plan.

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
