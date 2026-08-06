# Bandeja multicanal directa a Meta — el "adiós Leadsales"

## Por qué
El cliente pagaba **Leadsales** para juntar sus WhatsApp / Instagram / Facebook en una
sola bandeja. Leadsales es solo una **capa que cobra por sentarse encima de las APIs de
Meta**. El objetivo del proyecto es que Renovacell **deje de depender y pagar Leadsales**:
nos conectamos **directo a Meta**, y la bandeja vive dentro del sistema, junto a los
prospectos, los pedidos y el CRM — no en una herramienta aparte.

## Qué quedó construido (sin credenciales todavía)
- **Hilo de conversación** en cada prospecto (`meta.messages`): mensajes de entrada del
  canal + respuestas del vendedor, con burbujas y marca temporal.
  Administración/Ventas → **Prospectos → Ver detalle → Conversación**.
- **Mismo motor de captación** que la landing: cada mensaje entrante se **deduplica**
  (por teléfono en WhatsApp; por PSID en IG/Facebook) y se **auto-asigna** al vendedor
  con menos carga. Un lead no se duplica aunque escriba por dos canales.
- **Webhook `meta-webhook`** (Edge Function) que recibe de Meta, verifica firma y enhebra.
- **Responder** desde la bandeja: la respuesta se guarda al instante marcada **"por
  enviar"** hasta que se conecte la salida real (honesto en demo, no finge el envío).
- Seam **listo-para-credencial**: sin `META_*` la función responde `501`; con los secrets
  se enciende sin tocar código.

## Arquitectura

```
  WhatsApp / Instagram / Facebook (canales del cliente)
                     │  (Meta manda el mensaje)
                     ▼
   POST /functions/v1/meta-webhook   ← Edge Function (service role)
     1. verifica firma X-Hub-Signature-256 (META_APP_SECRET)
     2. extrae {canal, remitente, nombre, texto} según el canal
     3. dedup contra `prospects` (teléfono | PSID)
     4. asigna al vendedor con menos carga
     5. agrega el mensaje a meta.messages  +  notifica al vendedor
                     ▼
             tabla `prospects` (RLS staff-only)
                     ▼
      Prospectos → Ver detalle → Conversación (hilo + responder)
```

Sin cambios de esquema: el hilo vive en `prospects.meta.messages` (jsonb), junto a las
notas internas y el interés. El PSID de IG/Facebook se guarda en `prospects.meta.psid`
para deduplicar mensajes siguientes del mismo contacto.

## Contrato del webhook (`meta-webhook`)
- **GET** — verificación de suscripción de Meta. Responde `hub.challenge` si
  `hub.verify_token === META_VERIFY_TOKEN`.
- **POST** — mensaje entrante:
  - Verifica `X-Hub-Signature-256` = `sha256=HMAC_SHA256(body, META_APP_SECRET)`.
  - **WhatsApp Cloud API:** `entry[].changes[].value.messages[]` (`from` = teléfono;
    nombre desde `contacts[].profile.name`).
  - **Messenger / Instagram:** `entry[].messaging[]` (`sender.id` = PSID; `message.text`).
  - No-texto (imagen/audio) se registra como `[image]`/`[audio]` para no perder el contacto.
  - Siempre responde **200** (si no, Meta reintenta y duplica).

## Para encenderlo
Ver `docs/INTEGRACIONES.md` §7. Resumen:
1. Cliente aporta WhatsApp Business + página FB + IG Business (+ verificación Meta Business).
2. App de Meta con webhook apuntando a `…/functions/v1/meta-webhook`.
3. `supabase secrets set META_VERIFY_TOKEN=… META_APP_SECRET=…`
4. Desplegar: `supabase functions deploy meta-webhook --no-verify-jwt`.

## Envío de salida (`meta-send`) — construido, a falta de token
La función `meta-send` ya está construida: entrega la respuesta del vendedor por Graph
API (WhatsApp / Messenger / Instagram) y, al confirmar, quita el `pending` del mensaje en
el hilo. `replyProspect` la invoca con backend; si no está configurada (seam 501) o falla,
el mensaje queda "por enviar" (honesto). Requiere JWT (desplegar SIN `--no-verify-jwt`):
solo staff autenticado —no un doctor— puede responder.

**Para encender la salida:**
```
supabase secrets set WHATSAPP_TOKEN=<token del app de Meta>
supabase secrets set WHATSAPP_PHONE_ID=<phone_number_id de WhatsApp Business>
# Messenger / Instagram (opcional):
supabase secrets set META_PAGE_TOKEN=<page access token>
supabase functions deploy meta-send        # CON verificación de JWT
```
- Regla de Meta: fuera de la **ventana de 24 h** del último mensaje del cliente, WhatsApp
  exige **plantillas pre-aprobadas** (este envío de texto libre aplica dentro de la ventana).

## App Review de Meta
Para recibir de **cualquier** usuario (no solo cuentas con rol en el app) Meta exige
revisar los permisos de mensajería una vez (`whatsapp_business_messaging`,
`pages_messaging`, `instagram_manage_messages`). Es gratis pero tarda días. **Para la demo
no estorba:** funciona desde ya con las cuentas del propio cliente.