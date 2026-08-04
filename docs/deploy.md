# Guía de deploy y verificación — Renovacell

Runbook para dejar en producción lo construido. El **frontend** (landing + sistema) se
despliega solo en Netlify con cada push a `main`. Lo que NO es automático es el
**backend de Supabase**: migraciones de base de datos y Edge Functions. Esta guía cubre eso.

Proyecto Supabase: `amurlvlvfohwucvxfdot`

---

## 0. Requisitos (una sola vez)

```bash
# CLI de Supabase instalado (brew, npm o binario)
supabase --version

# Iniciar sesión (abre el navegador)
supabase login

# Enlazar este repo con el proyecto remoto
supabase link --project-ref amurlvlvfohwucvxfdot
```

> Si `link` pide la contraseña de la base, es la del proyecto en Supabase → Settings → Database.

---

## 1. Migraciones de base de datos  ⬅️ **pendiente**

Aplica las migraciones nuevas al remoto. Las pendientes de esta racha son:
- `20260804190000_devoluciones.sql` — tabla `refunds` + RPC `registrar_devolucion`
- `20260804200000_importar_lote_rpc.sql` — RPC `importar_lote` (lote + movimiento atómicos)

```bash
# Muestra qué migraciones faltan por aplicar (revisar antes)
supabase migration list

# Aplica las pendientes al remoto
supabase db push
```

Cada migración trae **auto-pruebas** (`ASSERT`): si algo no quedó (RLS, grants, la RPC),
`db push` **falla ruidosamente** — es la señal de que NO se aplicó a medias.

**Verificar que quedó** (sin entrar al dashboard, con la llave anon):
```bash
# refunds: un anónimo NO debe poder leerla → 401 "permission denied" = existe y está protegida
curl -s -o /dev/null -w "refunds: %{http_code}\n" \
  "https://amurlvlvfohwucvxfdot.supabase.co/rest/v1/refunds?select=id&limit=1" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
# Esperado: 401  (si da 404, la tabla no se creó)
```

---

## 2. Edge Function — verificación de identidad (KYC)  ⬅️ **pendiente**

```bash
# Despliega la función que verifica cédula + identidad y guarda la evidencia
supabase functions deploy register-doctor

# Confirmar que aparece desplegada
supabase functions list
```

Sin esto, la landing captura INE/selfie pero la función vieja los ignora (registro solo
por cédula, sin romperse).

---

## 3. Tipos generados (opcional)

Los tipos de `database.types.ts` ya se dejaron a mano para `refunds`, `registrar_devolucion`
e `importar_lote`. Para sincronizarlos con el remoto (recomendado tras el `db push`):

```bash
npm run supabase:types
```

---

## 4. Verificación en vivo (probar en la app, 5 minutos)

Con el frontend ya desplegado en Netlify + los pasos 1 y 2 hechos:

| Qué probar | Cómo | Señal de éxito |
|---|---|---|
| **KYC** | Registrarse en la landing con INE (frente/reverso) + selfie | La cuenta queda **"en revisión"**; en Admin → Doctores → Ver detalle aparece el panel de identidad con la evidencia |
| **Devolución** | Admin → Ventas → Detalle → un pedido pagado → **Devolver/Corregir** | Se registra, aparece en la lista del pedido y baja el **neto** en Finanzas |
| **Import atómico** | Admin → Importar → Inventario por lote → subir 1 fila | Crea el lote **y** su movimiento (Trazabilidad lo muestra); reimportar la misma fila dice **"ya existía"** |
| **Cobranza** | Admin → Finanzas | El panel **Cobranza** muestra vendido vs cobrado + tasa |
| **Ruta chofer** | Chofer → Mi ruta | Panel **"Orden de tu ruta"** con ▲▼; el orden se guarda |

---

## 5. Credenciales del cliente (cuando las entregue)

Estas activan lo que hoy está en modo *seam* (listo, esperando secret). Se ponen así:

```bash
supabase secrets set NOMBRE=valor
# y redeploy de la función que lo usa:  supabase functions deploy <función>
```

| Servicio | Secrets | Activa |
|---|---|---|
| **Identidad (Nubarium)** | `IDENTITY_API_URL`, `IDENTITY_API_KEY` | Auto-verificación biométrica en `register-doctor` |
| **Cédula (SEP)** | `CEDULA_API_URL`, `CEDULA_API_KEY` | Validación real de cédula |
| **Pagos** | (según Conekta/Stripe) | Cobro en línea |
| **CFDI / Paquetería / SMTP** | — | Factura, guías, correos |

Además (no son secrets, son datos): **costos reales de productos**, **campos legales**
del aviso de privacidad, **foto correcta del producto "Íntimo"**, y **cambiar las
contraseñas demo** antes de operar de verdad.

---

## 6. Notas

- **Orden importa**: haz el paso 1 (DB) **antes** de probar devoluciones/import, y el
  paso 2 (función) antes de probar KYC. Si no, esos botones dan error (no rompen nada más).
- **Rollback de una migración**: Supabase no revierte solo; si algo sale mal, se corrige
  con una migración nueva (nunca editando la ya aplicada) — es el patrón append-only del repo.
- **`db push` es acumulativo**: aplica TODO lo pendiente, no solo lo último. `migration list`
  te dice qué entrará antes de correrlo.