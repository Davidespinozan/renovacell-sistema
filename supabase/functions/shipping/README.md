# shipping — Paquetería (cotizar tarifas + generar guía)

Cotiza tarifas y genera guías contra un **agregador de paqueterías** real, con las llaves
protegidas en el servidor (nunca en el navegador). El cliente (`data/shipping/provider.ts`)
llama a esta función; si no está configurada (**501**), cae al **mock** y la demo sigue
igual. La pantalla de Empaque no cambia: misma firma `quoteRates` / `generateLabel`.

## Activar el agregador (sin tocar código)

```bash
supabase secrets set \
  SHIPPING_API_KEY="<token-del-agregador>" \
  SHIPPING_API_URL="https://api.envia.com" \   # base del proveedor
  SHIPPING_RATE_PATH="/ship/rate/" \           # ruta de cotización
  SHIPPING_LABEL_PATH="/ship/generate/"        # ruta de guía
```

Con `SHIPPING_API_KEY` presente, la función cotiza/genera de verdad. El mapeo de la
respuesta es **tolerante** (busca `carrier`, `service`, `totalPrice`, `deliveryEstimate`,
`trackingNumber`, `label`…). Si el contrato de tu proveedor difiere, se ajusta
`buildShipment` / los `pick(...)` en `index.ts` (una función, ~90 líneas).

## Agregadores en México

| Proveedor | Notas |
|---|---|
| **Envia.com** (api.envia.com) | Multi-paquetería (Estafeta, DHL, FedEx, Redpack…), REST estándar `POST /ship/rate/` y `/ship/generate/`, Bearer token. Es el default del adaptador. |
| **Skydropx** (api.skydropx.com) | Otro agregador MX popular; cambia rutas/campos → ajusta `SHIPPING_*` y el mapeo. |
| **Directo con la paquetería** | Estafeta/DHL tienen sus propias APIs; más trabajo de integración por cada una — un agregador las unifica. |

## Notas

- El origen (bodega) sale de `ORIGIN` en `provider.ts`; en producción conviene moverlo a
  la config de la organización (Supabase).
- La etiqueta real es el **PDF** que devuelve el agregador (`labelUrl`); el mock genera un
  HTML imprimible de demostración.
- El rastreo público lo arma `trackingUrl()` (Estafeta/DHL); amplíalo con las paqueterías
  que uses.

## T1 Envíos · API v2.0 (segundo proveedor, `provider: 't1'`)

Autenticación por cabeceras `X-Api-Key` + `shop_id`, solo dentro de la Edge. El host sale del AMBIENTE, nunca del cliente:

| `T1_API_ENV` | Host | Estado |
|---|---|---|
| `test` | `https://sandbox.t1api.com` | documentado en T1 Cuenta (sandbox: sin cargos ni envíos físicos según T1; verificar la cuenta) |
| `production` | *(sin confirmar)* | `production` NO opera hasta registrar el host en `HOSTS_T1` (t1.ts) |

```bash
# La llave nunca va en archivos ni en el chat; se escribe en la terminal sin eco:
read -s -p "T1 API key: " T1_API_KEY; echo
supabase secrets set T1_API_ENV="test" T1_API_KEY="$T1_API_KEY" T1_SHOP_ID="<shop_id>"
unset T1_API_KEY
```

Endpoints: `POST /t1-shipping/quote/create-with-quote` (cotizar: cp origen/destino, peso y medidas enteras, package_type 2,
`valor_paquete` = valor de la mercancía del pedido, Σ renglones, obligatorio en el sandbox aunque `insurance` sea false; sin
renglones con precio no se cotiza; CASO PENDIENTE: pedidos con descuentos deben declarar el valor real de la mercancía conforme
al contrato de T1, sin inventar importes; hoy se declara Σ cantidad × precio vendido de los renglones) y
`POST /t1-shipping/guide/create-guide` (guía con `quote_token`). Flujo igual que DHL: cotizar → el operador elige el servicio
(`serviceCode` = `PAQUETERIA|SERVICIO`) → `create_shipment` re-cotiza en el servidor, usa el token y guarda la guía/etiqueta
(`shipments.provider = 't1'`, `provider_meta.ambiente` = `test` | `production`; Empaque y Guías marcan "ambiente de pruebas").

**Contratos oficiales (T1 Cuenta, 20 oct 2026) ya implementados:** cotización `{success, detail[]}` (por servicio: carrier,
service_name, service_type, `total_cost` = total de T1, delivery_days, currency, token; opcionales insurance/extended_zone/
recommended sin inventar); guía con `quote_token`, `content`, `business_id` (= shop_id) y `origin_…`/`destination_…`
(first_name, last_name, email, phone, street, number, neighborhood, municipality, state, references), sin `generate_pickup`,
`has_notification` ni `guide_origin`; respuesta `detail.tracking_number`, `order_number`, `carrier`, `cost`, `guide_link`
(S3, no permanente: la etiqueta se sirve desde el bucket) y `file` (PDF base64, nunca en metadatos ni logs).
**Origen (migración 183):** la misma fuente que DHL (Configuración → Origen de envíos, nunca el domicilio fiscal), por campos:
calle, número exterior, interior/local, colonia, referencias (+ CP, ciudad, estado, país, teléfono y correo ya existentes).
Con calle y número capturados, el servidor arma `shipping_address` ("Calle Número Interior", máx. 45 = límite DHL) y es lo
que DHL recibe; con los campos vacíos, DHL sigue usando el texto legado. T1 exige los campos estructurados: sin ellos no hay guía.
**Identidad del servicio y precio:** al generar, el servidor re-cotiza, exige el mismo `serviceCode` y el mismo `total_cost` que
vio el operador; si cambian → 409 `precio_cambio` y hay que recotizar y confirmar. 409 de T1 (token usado/vencido) = intento
fallido sin reintento. **Pendientes (sin red):** rastreo y recolección v2.0 (endpoints no documentados) y el host productivo.

**Activación a producción (configuración, no programación):** host productivo confirmado y registrado → `T1_API_ENV=production`
con llave y shop_id productivos → saldo y permisos de la cuenta → pruebas completas en sandbox → alertas/observabilidad →
autorización explícita → una guía productiva controlada.

### T1-LIVE-01 · cotizar en producción sin guías (preparado, host pendiente)
Credenciales SEPARADAS por ambiente: sandbox usa `T1_API_KEY` + `T1_SHOP_ID`; producción usa `T1_LIVE_API_KEY` + `T1_LIVE_SHOP_ID`.
Con `T1_API_ENV=production`: (1) el host sale del registro `HOSTS_T1.production` (hoy `null`: hasta registrar el host oficial
de T1 Cuenta, production no opera); (2) cotizar exige `T1_LIVE_COTIZAR=on` y rol Dirección; (3) las GUÍAS están bloqueadas por
código (`GUIAS_LIVE_PERMITIDAS = false`) y el servidor responde 403 antes de cualquier claim, escritura o llamada; (4) la
cotización no escribe en la base ni cambia pedidos. Reversión: `T1_API_ENV=test` (vuelve al sandbox con sus propias llaves).

## T1-LIVE-02 · autenticación Keycloak para el host productivo (local, sin deploy)

El host productivo documentado por T1 (`https://apiv2.t1envios.com`) rechaza `X-Api-Key` (401 el 20 oct 2026) y exige
`Authorization: Bearer <access_token>` de Keycloak (`https://id.t1.com/realms/T1`). El adaptador soporta ahora dos modos
independientes, elegidos por ambiente:

| Variable | Valores | Uso |
|---|---|---|
| `T1_AUTH` / `T1_LIVE_AUTH` | `api_key` (defecto) · `keycloak` | modo del ambiente test / production |
| `T1_LIVE_KC_CLIENT_SECRET`, `T1_LIVE_KC_USERNAME`, `T1_LIVE_KC_PASSWORD` | obligatorias en keycloak | credenciales que entrega T1 (prefijo `T1_KC_` para test) |
| `T1_LIVE_KC_TOKEN_URL` | opcional | defecto `https://id.t1.com/realms/T1/protocol/openid-connect/token` |
| `T1_LIVE_KC_CLIENT_ID` | opcional | defecto `t1envios` (documentado) |
| `T1_LIVE_KC_GRANT` | opcional | solo `password` (único grant documentado); otro valor = `grant_no_soportado` |
| `T1_LIVE_SHOP_ID`, `T1_LIVE_COTIZAR` | como en T1-LIVE-01 | tienda y control de cotización live |

Comportamiento: token en caché por cuenta con vencimiento anticipado de 60 s (expires_in o 30 min); 400/401 del token endpoint =
`credenciales_rechazadas`, 403 = `sin_permisos`, 5xx = `proveedor`, red = `sin_respuesta` → la Edge responde 503/502 `t1_autenticacion`
sin llamar a T1. Un 401 de T1 en la cotización olvida el token (el siguiente intento pide uno nuevo). Las cabeceras se obtienen
DESPUÉS de los bloqueos de producción (guías live bloqueadas por código, solo Dirección, `T1_LIVE_COTIZAR`). Rutas del host
productivo sin prefijo `/t1-shipping`: cotización `/quote/create-with-quote`; la ruta de guía NO está confirmada (`null` → 501
`t1_ruta_no_confirmada`). El token y las credenciales nunca van a logs, respuestas ni mensajes.

Pendiente de T1 (ticket 49867905417): confirmar host y modo, entregar client_secret/usuario/contraseña del realm T1, confirmar
la ruta de guía y el shop_id de producción. Los secretos legado `T1_AUTH_URL`, `T1_CLIENT_SECRET`, `T1_USERNAME`, `T1_PASSWORD`
no se leen.
