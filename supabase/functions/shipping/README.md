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

## T1 Envíos (segundo proveedor, `provider: 't1'`)

Agregador de Grupo Carso (FedEx, DHL, UPS, Estafeta, 99 Minutos, AMPM…). Mismo contrato neutral que DHL: `rate` →
el operador elige el servicio (`serviceCode` = `PAQUETERIA|SERVICIO`) → `create_shipment` re-cotiza en el servidor, usa el
`token_quote` de T1 y guarda la guía/etiqueta igual que DHL (`shipments.provider = 't1'`, `carrier` = la paquetería real).
`sync_tracking` consulta `/webhook-maestro/query/estado-guia/:guia`; `schedule_pickup` usa `/pickup/create`
(`cancel_pickup` no existe en T1: se cancela en t1envios.com). Contrato: https://t1docs.dev.plataformat1.com/docs/T1Envios/t-1-envios/

Sin estas llaves la Edge responde **501** y Empaque lo dice en palabras ("T1 Envíos no está configurado"):

```bash
supabase secrets set \
  T1_API_URL="https://<host-de-la-api-que-entrega-T1>" \
  T1_AUTH_URL="https://<keycloak-de-T1>/auth/realms/<realm>/protocol/openid-connect/token" \
  T1_CLIENT_ID="t1envios" T1_CLIENT_SECRET="<client_secret>" \
  T1_USERNAME="<correo de la cuenta t1envios.com>" T1_PASSWORD="<contraseña>" \
  T1_SHOP_ID="<shop_id>" T1_COMERCIO_ID="<comercio_id (si es distinto)>" \
  T1_ORIGEN_COLONIA="<colonia de la sucursal>"   # T1 exige colonia del origen; la config de empresa no la tiene
```

Fecha/hora de T1: "YYYY-MM-DD HH:MM:SS" en hora del centro de México (UTC-6 fijo); el adaptador la convierte a ISO.
