# Fase de integración — guía para conectar los servicios externos

El sistema interno está 100% conectado a Supabase. Estas 5 integraciones son las
que necesitan **cuentas/llaves de terceros**. Cada una está diseñada como un *seam*:
mientras no pongas la llave, la app sigue con el comportamiento actual (mock) sin
romperse; en cuanto la pones, funciona de verdad **sin cambiar código**.

Los secretos NUNCA van al repo. Van en **Supabase → Project Settings → Edge
Functions → Secrets** (o `supabase secrets set`), o en el panel del servicio.

---

## 1. Stripe — cobro real de tarjeta ✅ (ya listo, solo pegar llaves)

**Ya desplegado:** Edge Functions `stripe-checkout` (crea la sesión de pago) y
`stripe-webhook` (marca el pedido pagado). El cliente ya las usa: cuando el doctor
paga con tarjeta, si Stripe está habilitado redirige a la página de pago de Stripe;
si no, cae al flujo actual.

**Para activarlo:**
1. Crea cuenta en Stripe → obtén tu **Secret key** (`sk_live_...` o `sk_test_...`).
2. En Supabase, agrega el secreto:
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
   ```
3. En el dashboard de Stripe → **Developers → Webhooks → Add endpoint**:
   - URL: `https://amurlvlvfohwucvxfdot.supabase.co/functions/v1/stripe-webhook`
   - Eventos: `checkout.session.completed` (y opcional `payment_intent.succeeded`).
   - Copia el **Signing secret** (`whsec_...`) y agrégalo:
     ```
     supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
     ```
4. Listo. El doctor paga → Stripe cobra → el webhook marca el pedido `paid` y se
   libera a Almacén. Sin más cambios.

---

## 2. Facturama — CFDI (factura) real

**Hoy:** "Emitir CFDI" marca el pedido como facturado con un folio fiscal simulado.

**Para activarlo (patrón):**
1. Cuenta en Facturama + tus **datos fiscales + CSD** (certificado de sello).
2. Crear una Edge Function `emit-cfdi` que reciba `order_id`, arme el CFDI con los
   datos del pedido y llame a la API de Facturama con `FACTURAMA_USER`/`FACTURAMA_PASS`.
3. Guardar el UUID fiscal real + PDF/XML en `orders.invoice_meta`.
4. Cambiar `markInvoiced` (ordersStore) para invocar esa función en vez del folio mock.

Secretos: `FACTURAMA_USER`, `FACTURAMA_PASS` (+ subir el CSD en Facturama).

---

## 3. Paquetería — guía de envío real (Estafeta / DHL / Skydropx)

**Hoy:** "Generar guía" produce una guía sintética (el envío sí se guarda).

**Para activarlo (patrón):**
1. Cuenta en el agregador (Skydropx recomendado: multi-carrier) → API key.
2. Edge Function `create-label` que cotice y genere la guía real (tracking + PDF).
3. Guardar `carrier`, `tracking_number`, `label_url` reales en `shipments`.
4. Cambiar `quoteRates`/`generateLabel` (data/shipping/provider) para llamar la función.

Secreto: `SHIPPING_API_KEY`.

---

## 4. IA — asistente con modelo real (Claude / GPT)

**Hoy:** el asistente del doctor (y el de la landing) responden con reglas locales.

**Para activarlo (patrón):**
1. Llave de API de Anthropic (Claude) u OpenAI.
2. Edge Function `assistant` que reciba el mensaje + contexto (catálogo, estatus de
   pedidos del doctor) y llame al modelo con la llave **en el servidor** (nunca en el
   cliente).
3. Cambiar `useAssistant`/el widget de la landing para llamar la función.

Secreto: `ANTHROPIC_API_KEY` (o `OPENAI_API_KEY`).

---

## 5. Correo (SMTP) — enlaces de acceso a doctores/usuarios

**Hoy:** "Enviar acceso al Portal" marca al doctor como invitado, pero no envía el
correo con el enlace mágico (el usuario de auth SÍ se crea vía `invite-doctor`).

**Para activarlo:**
1. En Supabase → **Authentication → Email (SMTP)**, configura un proveedor
   (Resend, SendGrid, Postmark…).
2. Cambiar `invite-doctor`/`inviteDoctor` para usar
   `admin.auth.admin.inviteUserByEmail(email)` (envía el enlace de establecer
   contraseña). Con SMTP configurado, el correo sale solo.

---

## 6. Verificación de identidad (KYC · Nubarium) — que quien se registra ES el doctor

**Hoy:** el registro valida la **cédula** contra el registro oficial (seam `CEDULA_API_*`
en `register-doctor`) y captura **selfie + INE**, pero la capa **biométrica** (prueba de
vida + validez del INE + match selfie↔INE) corre en modo *sin proveedor*: toda cuenta
con identidad adjunta queda **EN REVISIÓN** para que Dirección apruebe viendo la evidencia
(selfie + INE) en **Administración → Doctores → Ver detalle**.

**Para activarlo (Nubarium):**
1. Contratar Nubarium y obtener las llaves de sus servicios (liveness + INE + biometría).
2. En Supabase → **Edge Functions → Secrets**, configura:
   - `IDENTITY_API_URL` — endpoint del flujo de verificación de Nubarium.
   - `IDENTITY_API_KEY` (+ opcional `IDENTITY_API_KEY_HEADER`, `IDENTITY_API_AUTH_SCHEME`).
3. Listo. `register-doctor` empieza a llamar a Nubarium: los casos 100% verdes
   (persona viva + INE válido + rostro ≥85% + nombre del INE ≈ cédula) se **auto-verifican**;
   los dudosos siguen cayendo a revisión manual. **No se toca código.**

La cédula la seguimos validando nosotros (SEP) para abaratar consultas. Ver
`docs/verificacion-kyc.md` para el flujo completo y la matriz de decisión.

Secretos: `IDENTITY_API_URL`, `IDENTITY_API_KEY`. Simulador para demos: `IDENTITY_SIMULATE=true`.

---

## 7. Multicanal — WhatsApp / Instagram / Facebook directo a Meta (reemplazo de Leadsales)

**El objetivo:** que Renovacell **deje de pagar y depender de Leadsales**. Leadsales no
es más que una capa que cobra por sentarse encima de las APIs de Meta; nosotros nos
conectamos **directo a Meta**, sin intermediario.

**Hoy:** la bandeja de prospectos ya tiene el **hilo de conversación** por canal
(Administración/Ventas → Prospectos → Ver detalle): mensajes de entrada y respuestas del
vendedor, con el mismo motor de **dedup + auto-asignación** que la landing. En modo demo
se puede captar un lead con su primer mensaje y responder (la respuesta queda **"por
enviar"** hasta conectar Meta). La ingesta real corre por la Edge Function `meta-webhook`.

**Para activarlo:**
1. El cliente aporta sus **activos de Meta**: número de **WhatsApp Business** (dedicado a
   la API, no en la app normal), **página de Facebook** y **cuenta de Instagram Business**
   vinculada a la página. Requiere **verificación de Meta Business** (la hace Meta).
2. Crear un **app de Meta** (developers.facebook.com) con los productos *WhatsApp*,
   *Messenger* e *Instagram*, y suscribir el webhook a:
   `https://amurlvlvfohwucvxfdot.supabase.co/functions/v1/meta-webhook`
   con un **Verify Token** que tú eliges.
3. En Supabase → **Edge Functions → Secrets**:
   ```
   supabase secrets set META_VERIFY_TOKEN=<el-que-elegiste>
   supabase secrets set META_APP_SECRET=<App Secret del app de Meta>
   ```
   Desplegar con `--no-verify-jwt` (Meta no manda JWT de Supabase).
4. Meta llama al webhook (GET) para verificar → responde el challenge. A partir de ahí,
   cada mensaje entrante crea/actualiza el prospecto y **abre su hilo** — sin Leadsales.

**Envío de respuestas (salida):** la Edge Function `meta-send` ya está construida (entrega
por Graph API y quita el "por enviar" al confirmar). Solo falta el **token de salida**:
```
supabase secrets set WHATSAPP_TOKEN=xxx WHATSAPP_PHONE_ID=xxx
supabase functions deploy meta-send        # CON JWT (solo staff responde)
```
Messenger/Instagram usan además `META_PAGE_TOKEN`. Sin token, la respuesta queda "por
enviar". Regla de Meta: fuera de la ventana de **24 h** del último mensaje del cliente, la
salida requiere **plantillas pre-aprobadas**. Recibir es gratis; WhatsApp cobra por conversación.

> **App Review de Meta:** para recibir de CUALQUIER usuario (no solo cuentas con rol en el
> app) Meta pide revisar los permisos de mensajería una vez (gratis, tarda días). Para la
> demo funciona ya con las cuentas del propio cliente. Ver `docs/multicanal-meta.md`.

---

### Resumen de secretos por servicio
| Servicio | Secretos |
|---|---|
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Facturama | `FACTURAMA_USER`, `FACTURAMA_PASS` (+ CSD) |
| Paquetería | `SHIPPING_API_KEY` |
| IA | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| Correo | SMTP en Supabase Auth |
| Cédula (SEP) | `CEDULA_API_URL`, `CEDULA_API_KEY` |
| Identidad KYC (Nubarium) | `IDENTITY_API_URL`, `IDENTITY_API_KEY` |
| Multicanal Meta (entrada) | `META_VERIFY_TOKEN`, `META_APP_SECRET` |
| Multicanal Meta (salida, pendiente) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` |
