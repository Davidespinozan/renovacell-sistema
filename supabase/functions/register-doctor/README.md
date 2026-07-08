# register-doctor — Auto-registro del doctor con verificación SEP instantánea

Endpoint PÚBLICO (`--no-verify-jwt`). El doctor se registra (nombre + correo + cédula +
contraseña) y aquí, del lado servidor:
1. anti-spam (honeypot `website`) + validación,
2. verifica la cédula contra el registro (SEP/RENAPO) con el MISMO criterio que
   `verify-cedula` (match de nombre + profesión médica + score),
3. según el dictamen:
   - **auto** → crea la cuenta ya **verificada** con esa contraseña (el doctor entra al
     instante) + avisa a Dirección,
   - **review** / **reject** → deja un **prospecto** para Dirección (sin cuenta) y
     devuelve el motivo,
   - **exists** → el correo ya tiene cuenta (que inicie sesión).

Devuelve `{ decision }` (+ `reasons` en review/reject). El cliente (`useAuth.register`)
inicia sesión automáticamente cuando el dictamen es `auto`.

## Flujo completo
Landing "Acceso médico" → sistema (Login) → "Verifica tu cédula y crea tu cuenta" →
`register-doctor` → **auto: entra al portal** · **review: a revisión de Dirección** ·
**reject: motivo**.

## Consulta al registro (mismo SEAM que verify-cedula)
Con `CEDULA_API_URL` + `CEDULA_API_KEY` configurados, consulta el proveedor real
(RENAPO/KYC); sin ellos, usa el **simulador** (último dígito: 0→no existe, 9→no médico,
8→a nombre de otro, resto→médico). Ver `../verify-cedula/README.md`.

## Nota de endurecimiento (producción)
Crea cuentas verificadas desde un endpoint público: el gate es la verificación SEP
(cédula real + nombre coincide). Para producción conviene sumar **rate-limiting /
captcha** y, opcionalmente, anti-suplantación (OCR de cédula/INE + selfie). El honeypot
y la validación cubren lo básico.
