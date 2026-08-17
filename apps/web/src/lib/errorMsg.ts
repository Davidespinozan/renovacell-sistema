// Traducción de errores técnicos → lenguaje de OPERADOR (aprendido de sala-studio).
// Un error de RPC/RLS/red nunca debe llegar crudo a la pantalla frente a un cliente:
// "PGRST116" o "42501" no le dicen al operador qué hacer. Aquí un mapa único de códigos
// (los que RAISEan las RPCs de Renovacell + los técnicos comunes) a frases accionables.
// Uso: catch → say('err', traducirError(e)).

// Códigos que RAISEan las RPCs/triggers de Renovacell → mensaje operable.
const CODIGOS: { match: RegExp; msg: string }[] = [
  // Negocio (RAISE EXCEPTION 'CODIGO: ...')
  { match: /MOTIVO_REQUERIDO/i, msg: 'Escribe el motivo — es obligatorio.' },
  { match: /MONTO_INVALIDO|MONTO_EXCEDE|TOPE/i, msg: 'El monto no es válido o excede lo permitido.' },
  { match: /TIPO_INVALIDO/i, msg: 'El tipo seleccionado no es válido.' },
  { match: /NO_AUTORIZAD|PRIVILEGIO_DENEGAD/i, msg: 'No tienes permiso para hacer esta acción.' },
  { match: /PEDIDO_INVALIDO|ORDEN_INVALIDA/i, msg: 'Ese pedido no admite esta operación.' },
  { match: /SIN_STOCK|STOCK_INSUF|EXISTENCIA|OVERSELL|cantidad/i, msg: 'No hay existencia suficiente en almacén.' },
  { match: /ESTADO_TERMINAL/i, msg: 'Ese pedido ya está cerrado (cancelado o entregado) y no se puede modificar.' },
  { match: /LEDGER_APPEND_ONLY/i, msg: 'Ese registro es histórico y no se edita. Para corregir, asienta uno nuevo.' },
  { match: /YA_PAGAD|ALREADY_PAID/i, msg: 'Ese pedido ya está pagado.' },
  { match: /CEDULA|IDENTIDAD|EN REVISION/i, msg: 'La verificación del doctor sigue pendiente.' },
  // Postgres genéricos
  { match: /23505|duplicate key|unique_violation|ya existe/i, msg: 'Ese registro ya existe (duplicado).' },
  { match: /23503|foreign key|violates foreign/i, msg: 'No se puede: hay información relacionada que lo impide.' },
  { match: /23514|check constraint|check_violation/i, msg: 'Un dato no cumple las reglas del sistema. Revísalo.' },
  { match: /42501|row-level security|violates row-level/i, msg: 'No tienes permiso para ver o cambiar esto.' },
  { match: /PGRST(116|301)|no rows|not found/i, msg: 'No se encontró el registro (quizá alguien lo cambió). Recarga e intenta de nuevo.' },
  // Autenticación (Supabase Auth, mensajes en inglés)
  { match: /invalid login credentials|invalid credentials/i, msg: 'Correo o contraseña incorrectos.' },
  { match: /password should be at least|weak.?password|at least 6/i, msg: 'La contraseña debe tener al menos 6 caracteres.' },
  { match: /already registered|already been registered|user.*exists/i, msg: 'Ese correo ya tiene una cuenta.' },
  { match: /email not confirmed/i, msg: 'Falta confirmar tu correo antes de entrar.' },
  { match: /new password should be different|same.?password/i, msg: 'La nueva contraseña debe ser distinta a la anterior.' },
  { match: /rate limit|too many requests|429/i, msg: 'Demasiados intentos. Espera un momento y reintenta.' },
  { match: /token has expired|expired|invalid.*token/i, msg: 'El enlace expiró. Solicita uno nuevo.' },
  // Red / conexión
  { match: /Failed to fetch|NetworkError|network|ECONN|timeout|ETIMEDOUT/i, msg: 'Sin conexión con el servidor. Revisa tu internet y reintenta.' },
  { match: /501|not_configured|no configurad/i, msg: 'Ese servicio aún no está activado (falta la credencial).' },
]

// Extrae el texto de cualquier forma de error (Error, string, {message}, {error}).
function textoDe(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  const o = err as { message?: unknown; error?: unknown; error_description?: unknown; details?: unknown }
  return String(o.message ?? o.error_description ?? o.error ?? o.details ?? '')
}

// Devuelve un mensaje en español, accionable, en 3ª persona. Si nada coincide, un
// fallback honesto (no expone el stack). `fallback` permite un texto propio del contexto.
export function traducirError(err: unknown, fallback = 'No se pudo completar la acción. Intenta de nuevo.'): string {
  const t = textoDe(err)
  if (!t) return fallback
  // Si la RPC ya mandó un mensaje legible tras el 'CODIGO: mensaje', úsalo.
  for (const c of CODIGOS) if (c.match.test(t)) return c.msg
  const trasDosPuntos = t.includes(': ') ? t.slice(t.indexOf(': ') + 2).trim() : t
  // Evita mostrar códigos crudos o rutas técnicas.
  if (/^[A-Z0-9_]{4,}$|PGRST|SQLSTATE|\bat\b.*\.(ts|js)/.test(trasDosPuntos)) return fallback
  return trasDosPuntos.length > 4 && trasDosPuntos.length < 160 ? trasDosPuntos : fallback
}
