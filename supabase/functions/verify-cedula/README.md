# verify-cedula — Verificación automática de cédula (IA + SEP)

Valida la cédula profesional contra el **Registro Nacional de Profesionistas (SEP/RENAPO)**
y decide sola: `auto` (verifica y da acceso) · `review` (cola de Dirección) · `reject`.
El criterio (match de nombre, profesión médica, score) vive en el código; la **consulta al
registro** es un adaptador **proveedor-agnóstico**.

## Activar el proveedor real (sin tocar código)

Hoy corre en **modo simulador** (determinista por el último dígito de la cédula). Para
usar un proveedor real, configura estos **secrets** en Supabase y el adaptador HTTP se
activa solo:

```bash
supabase secrets set \
  CEDULA_API_URL="https://<proveedor>/validar-cedula" \
  CEDULA_API_KEY="<tu-clave>" \
  CEDULA_API_KEY_HEADER="Authorization" \   # o 'x-api-key', según el proveedor
  CEDULA_API_AUTH_SCHEME="Bearer"           # usa "" si el header lleva la clave pelona
```

El adaptador hace `POST {cedula, nombre}` y mapea la respuesta buscando los campos
comunes (`nombre`, `profesion`, `año de expedición`, `institución`). Si tu proveedor usa
GET o nombres muy distintos, se ajusta `lookupSepHttp` en `index.ts`. Sin `CEDULA_API_URL`,
queda el simulador (útil para demo).

## Proveedores en México (todos envuelven RENAPO/SEP)

| Proveedor | Notas |
|---|---|
| **APIMarket** (apimarket.mx) | Marketplace MX, "Valida/Busca Cédula Profesional", REST simple, pago por consulta. Buen primer proveedor. |
| **Kiban Cloud** (docs.kiban.com) | API documentada; responde nombre completo, profesión, año, institución, tipo (A1/B1/C1). |
| **Nubarium** (nubarium.com) | Validación por "robots" a páginas de gobierno; incluye cédula SEP. También en RapidAPI. |
| **Verifica ID** (verificaid.mx) | Consulta SAT/RENAPO/SEP/IMSS; KYC de identidad. |
| **KYC Systems** (kyc-systems.com) | Cédula por nombre completo + CURP/RFC + listas negras (PLD). |

> No hay API pública oficial gratuita de la SEP; el registro público es
> `cedulaprofesional.sep.gob.mx`. Se recomienda un proveedor (arriba) por estabilidad y
> términos de uso.

## Anti-suplantación (opcional, siguiente fase)

El adaptador confirma que la cédula existe y es de un profesional de salud a nombre del
titular. Para evitar que alguien use la cédula de OTRO, se puede sumar OCR de la
cédula/INE + selfie con detección de vida (los mismos proveedores lo ofrecen); encaja
antes de `decide()` sin cambiar la compuerta.
