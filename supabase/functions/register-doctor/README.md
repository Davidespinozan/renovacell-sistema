# register-doctor — Auto-registro del doctor (verificación manual)

Endpoint PÚBLICO (`--no-verify-jwt`). El doctor se registra desde la landing (nombre, correo, cédula, celular,
domicilio opcional, aviso de privacidad y fotos del INE por ambos lados) y aquí, del lado servidor:

1. anti-spam (honeypot `website`), validación y limitador por IP y global,
2. si el correo ya tiene cuenta → `exists`,
3. crea la cuenta **siempre en revisión** (`verified = false`, `verification.status = 'pending'`),
4. guarda las fotos del INE en el bucket privado `proofs` (`identity/<uid>/ine-front|ine-back.<ext>`),
5. avisa a Dirección.

Devuelve `{ decision: 'pending', reasons }` o `{ decision: 'exists', message }`.

**Sin verificación automática** (decisión del dueño, oct 2026): no se consulta la SEP ni ningún proveedor KYC y no
se pide selfie. Aprueba una persona: Dirección (Doctores → Revisar / Aprobar) o su vendedor desde el chat
(`doctor_verificar`). Con la cuenta pendiente el doctor entra al portal sin precios.
