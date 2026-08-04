# Verificación de identidad del doctor (KYC)

Objetivo: que **quien se registra ES el doctor**, no solo alguien con sus documentos.
La cédula sola no prueba identidad — cualquiera podría teclear la cédula de un médico
real. Por eso encadenamos **cédula + identidad biométrica**.

## Las dos capas

| Capa | Qué comprueba | Proveedor | Estado |
|---|---|---|---|
| **Cédula** | La cédula existe, es del área médica y el nombre coincide | SEP/RENAPO (seam `CEDULA_API_*`) | Listo (motor `register-doctor` + `verify-cedula`) |
| **Identidad** | Persona viva (liveness) · INE válido · rostro selfie ↔ INE · nombre INE ≈ cédula | **Nubarium** (seam `IDENTITY_API_*`) | Seam listo; falta credencial del cliente |

## Flujo (el candado)

1. El doctor llena el registro en la landing: nombre, correo, cédula, contraseña.
2. Captura **INE (frente/reverso)** + **selfie** (la landing reduce cada foto a ~1200px antes de enviar).
3. `register-doctor` (Edge Function, servidor) corre en paralelo:
   - **Cédula** → SEP: ¿existe? ¿médica? ¿nombre coincide?
   - **Identidad** → Nubarium: prueba de vida + INE válido + match biométrico + nombre del INE.
4. Cruza todo y decide (matriz abajo).
5. La evidencia (selfie + INE) se guarda en el bucket **privado `proofs`** (`identity/<uid>/…`).

## Matriz de decisión

| Cédula | Identidad | Resultado |
|---|---|---|
| Válida (auto) | 100% verde (viva + INE válido + rostro ≥85% + nombre ≈) | **Cuenta VERIFICADA al instante** — acceso al catálogo |
| Existe | Incompleta / proveedor no disponible | **Cuenta EN REVISIÓN** — Dirección aprueba viendo la evidencia |
| No existe / nombre no coincide | — | **Rechazo** → prospecto (sin cuenta) + motivo |
| Cualquiera | Rostro NO coincide / no hay prueba de vida | **Rechazo** → prospecto + motivo |
| Válida | Sin fotos (compat) | Comportamiento anterior: cédula auto → verificado |

> **Falla nuestra ≠ rechazo.** Si el proveedor está caído o sin configurar, la identidad
> queda `unavailable` → **revisión manual**, nunca rechazo (no acusar en falso a un médico real).

## Revisión en Administración

**Administración → Doctores → Ver detalle** muestra el panel *Verificación de identidad (KYC)*:
- Dictamen de Nubarium (prueba de vida ✓/✗, INE válido ✓/✗, rostro %).
- La **evidencia** (selfie + INE) con URL firmada del bucket privado (solo staff, RLS `proofs`).
- El botón **Verificar doctor** aprueba (pone `profiles.verified = true` → habilita el catálogo).

Mientras Nubarium no esté configurado, el panel indica *"revisión manual"* y el revisor
compara la selfie con la foto del INE a ojo antes de aprobar.

## Activar Nubarium (sin tocar código)

En Supabase → Edge Functions → Secrets:
- `IDENTITY_API_URL` — endpoint del flujo de verificación.
- `IDENTITY_API_KEY` (+ opcional `IDENTITY_API_KEY_HEADER`, `IDENTITY_API_AUTH_SCHEME`).

Desde ese momento los casos 100% verdes se auto-verifican; los dudosos siguen a revisión.
Para demos sin proveedor: `IDENTITY_SIMULATE=true` (devuelve un match alto simulado).

## Costo

Lo asume el cliente (renta mensual por consultas de Nubarium). Se abarata validando la
**cédula por SEP nosotros** y pidiendo a Nubarium solo liveness + INE + biometría.
Ver [[renovacell-kyc-provider]] en memoria.