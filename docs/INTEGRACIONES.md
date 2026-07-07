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

### Resumen de secretos por servicio
| Servicio | Secretos |
|---|---|
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Facturama | `FACTURAMA_USER`, `FACTURAMA_PASS` (+ CSD) |
| Paquetería | `SHIPPING_API_KEY` |
| IA | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| Correo | SMTP en Supabase Auth |
