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
