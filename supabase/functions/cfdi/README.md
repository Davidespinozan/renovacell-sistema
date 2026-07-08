# cfdi — Timbrado CFDI 4.0 (Facturama / PAC)

Timbra la factura de un pedido en el SAT vía **Facturama** (PAC), con las credenciales
protegidas en el servidor. El cliente (`markInvoiced` en ordersStore) llama a esta
función; si no está configurada (**501**) queda el **folio simulado** (demo). Con éxito,
reemplaza el folio simulado por el **UUID real** del SAT.

## Activar Facturama (credencial)

```bash
supabase secrets set \
  FACTURAMA_USER="<usuario>" \
  FACTURAMA_PASSWORD="<password>" \
  FACTURAMA_URL="https://api.facturama.mx" \   # sandbox: https://apisandbox.facturama.mx
  FACTURAMA_SERIE="A" \                         # opcional
  FACTURAMA_PRODUCT_CODE="51241100" \           # ClaveProdServ SAT por defecto
  FACTURAMA_UNIT_CODE="H87"                     # ClaveUnidad (Pieza)
```

La cuenta de Facturama debe tener **cargado el CSD** (certificado de sello digital) del
emisor. Auth: HTTP Basic. Endpoint: `POST /3/cfdis`. La respuesta trae el UUID en
`Complement.TaxStamp.Uuid`.

## Requisito IMPORTANTE: datos fiscales

Timbrar de verdad no es solo la credencial — el SAT exige datos que la app aún no captura:

- **Del receptor (doctor):** RFC, razón social, **uso CFDI**, **régimen fiscal**, **CP
  fiscal**. La función los lee de `profiles.meta.fiscal` (`{ rfc, name, cfdiUse, taxRegime,
  taxZip }`) o del payload; si faltan, responde **422** y avisa a Dirección (no timbra a
  ciegas). → Falta una pequeña captura de estos campos en el perfil del doctor.
- **De los productos:** la **ClaveProdServ** y **ClaveUnidad** SAT correctas por producto
  (hoy usa un default configurable; conviene guardarlas por producto).
- **Impuestos:** se asume precio **IVA-incluido (16%)** y se desglosa. Ajusta si manejas
  tasa 0 / exento / retenciones.

Es decir: **credencial + captura de datos fiscales** = timbrado real. La plomería
(función, fallback, desglose, UUID) ya está.

## Alternativas al PAC
Facturama es el más directo (API sencilla). Otros: **factura.com**, **gigstack**, o
integrar el PAC directamente. Todos requieren los mismos datos fiscales de arriba.
