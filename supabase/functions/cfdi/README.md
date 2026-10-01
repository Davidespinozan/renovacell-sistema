# cfdi — CONTENIDA (W3-A). Esta función ya no timbra.

> **No intentes "activarla" metiendo secrets.** El timbrado se rehace en **W3-B** sobre la
> intención fiscal durable. Esta función responde **423 `w3_contencion`** y no sale a la red.

## Por qué se contuvo

La versión anterior tenía este camino, y bastaba un **timeout** para recorrerlo:

```
POST /3/cfdis (sin timeout)   → el PAC PUDO timbrar
→ se pierde la respuesta      → el cliente marcaba el fallo
→ el cliente escribía invoice_meta = null   ← se destruía el folio fiscal
→ la UI volvía a ofrecer "Emitir CFDI"      → segundo POST
→ DOS CFDI reales ante el SAT por un solo pedido
```

Y además: persistía `status:'timbrada'` aunque el cuerpo del PAC viniera vacío o sin UUID,
no verificaba el resultado de la escritura, no tenía reclamo atómico, y su URL base caía
**por defecto a producción** del PAC.

Principio que ordena W3: **TIMEOUT / ERROR DE RED ≠ "NO SE TIMBRÓ".**

## Qué existe ya (W3-A, en la base de datos)

| Pieza | Para qué |
|---|---|
| `fiscal_documents` | la **intención** fiscal durable, escrita ANTES de cualquier salida al PAC |
| `fiscal_document_events` | bitácora append-only: ninguna transición de estado ocurre sin registrarse |
| `fiscal_operations` | idempotencia por `op_id` (gemelo de inventario / dinero / custodia) |
| `solicitar_cfdi()` | registra o corrige la solicitud, con el receptor **congelado** |
| `reclamar_cfdi()` | reclamo **atómico** que además fija la identidad ante el PAC (serie REN, folio y `Date`). W3-B retiró `_w3_reclamar`: un reclamo sin identidad ya no es un estado válido |
| `conciliar_cfdi()` | conciliación **local** (C1…C11). La externa contra el PAC es W3-B/D |
| `orders_guard` | `invoice_meta` / `invoice_requested` ya **no los escribe ningún cliente** |

Estados: `pendiente → en_proceso → timbrado | fallido | incierto`, `incierto → timbrado |
fallido` (**solo por conciliación**), `timbrado → cancelado`.

- **`fallido`** = se demuestra que el PAC **no** produjo efecto → se puede reintentar.
- **`incierto`** = pudo producirlo → **no se reintenta nunca**, se concilia.

Dos constraints hacen imposible el P0 por estructura, no por convención:
`(uuid is not null) = (status in ('timbrado','cancelado'))` y un índice único parcial que
admite **una sola** intención viva por pedido.

## Configuración del PAC: fail-closed

`FACTURAMA_URL` **ya no existe**. El entorno es explícito y la URL se **deriva** de él:

```bash
supabase secrets set \
  FACTURAMA_ENV="sandbox" \      # sandbox | produccion — SIN default
  FACTURAMA_USER="<usuario>" \
  FACTURAMA_PASSWORD="<password>"
```

Ausente o inválido ⇒ **501 `config_incompleta`** y la operación bloqueada. Nunca se asume
producción. Cada documento fiscal guarda su `provider_env`, así que un comprobante de
sandbox no puede confundirse con uno real. Aplica también a `cfdi-cancel`,
`cfdi-cancel-status`, `cfdi-download` y `cfdi-send` (ver `../_shared/facturama.ts`).

## Lo que falta para timbrar de verdad (W3-B y W3-C)

**W3-B** — adaptador del PAC: `AbortSignal` con timeout, clasificación de cada resultado
(red/timeout → `incierto`; 4xx de validación → `fallido`; 2xx sin UUID → `incierto`),
persistencia verificada y **recuperación de timbre huérfano** consultando al PAC por
serie+folio propios.

> **Dependencia de información, no decisión del dueño:** el endpoint exacto de Facturama
> para consultar un comprobante emitido por serie/folio debe confirmarse en su documentación
> al implementar. Si no existe, cambia la llave de búsqueda del huérfano.

**W3-C** — decisiones **fiscales del dueño**, que W3-A deliberadamente **no** inventó:

| | Abierto |
|---|---|
| D-W3-1 | FormaPago de tarjeta: 04 (crédito) o 28 (débito) |
| D-W3-2 | FormaPago de un cobro por Stripe |
| D-W3-3 | Venta cobrada con dos métodos: 99, el dominante, o bloquear |
| D-W3-4 | **IVA por producto**: ¿todo es 16%? Si hay 0% o exento, timbrar al 16% es un error fiscal material |
| D-W3-5 | ClaveProdServ por producto vs. una global |
| D-W3-6 | Descripción fiscal por renglón |
| D-W3-7 | Serie y folio propios (necesarios para detectar huérfanos) |
| D-W3-8 | PPD + REP para ventas a crédito |
| D-W3-9 | Refacturación (sustitución, motivo 01) |

Por eso `fiscal_documents` guarda `total` y `currency` pero deja `subtotal`, `iva`,
`forma_pago` y `metodo_pago` **nulos**: se derivan del libro de W2 en W3-C, con la política
fiscal ya decidida. La huella material va versionada (`w3a-1:<md5>`) para que, al integrarlas,
la diferencia sea detectable.

## Reglas puras preservadas

`./rules.ts` conserva —probadas— las reglas que esta función aplicaba y que W3-B volverá a
usar: `normFiscal` / `fiscalFaltantes` (receptor canónico, **sin defaults** 616/G03),
`puedeTimbrar` (gate de pago), `cfdiYaTimbrado` (idempotencia que exige UUID, no solo estado)
y `lugarDeExpedicion` (CP del **emisor**, nunca el del receptor).
